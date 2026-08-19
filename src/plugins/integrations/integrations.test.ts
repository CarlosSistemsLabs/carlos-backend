import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../plugin-registry.js';
import { PluginType, PaymentStatus } from '../plugin.js';
import type {
  PaymentPlugin,
  PluginContext,
  PluginMetadata,
  PaymentRequest,
  PaymentResult,
  AICompletionRequest,
  AICompletionResult,
  AIAnalysisRequest,
  AIAnalysisResult,
} from '../plugin.js';
import { InvoiceAuthorizationStatus } from './payment-integrations.js';
import type {
  MercadoPagoIntegration,
  MercadoPagoConfig,
  MercadoPagoPreferenceRequest,
  MercadoPagoPreference,
  AfipIntegration,
  InvoiceAuthorizationRequest,
  InvoiceAuthorizationResult,
} from './payment-integrations.js';
import type { OpenAiIntegration, OcrIntegration, OcrRequest, OcrResult } from './ai-integrations.js';
import type {
  IWebhookReceiver,
  WebhookRequest,
  WebhookEvent,
  WebhookVerificationResult,
} from './webhook.js';

/**
 * Contract-drift guard for the task 35.3 external-service integration seams
 * (Requirement 19.2).
 *
 * These are PREPARATION contracts, so the tests build tiny in-memory FAKES that
 * implement a representative subset of the integration interfaces and assert:
 *  - each fake structurally satisfies its integration interface AND the base
 *    plugin contract it extends (compile-time + runtime);
 *  - the fakes register into the {@link PluginRegistry} and are discoverable by
 *    {@link PluginType} (the same seam a concrete adapter binds through);
 *  - the generic {@link IWebhookReceiver} verify → parse → idempotency flow
 *    behaves as documented.
 * No vendor SDK or network call is involved.
 */

const noopLogger = {
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
};

/** A fake Mercado Pago payment integration (payment + webhook capable). */
class FakeMercadoPago implements MercadoPagoIntegration {
  public readonly metadata: PluginMetadata = {
    id: 'mercadopago',
    name: 'Mercado Pago',
    version: '1.0.0',
    type: PluginType.Payment,
  };

  public initialized = false;
  public active = false;
  private config: MercadoPagoConfig = { accessToken: 'resolved-at-load-time' };

  public readonly webhookReceiver: IWebhookReceiver = new FakeSignatureReceiver('mercadopago');

  async initialize(context: PluginContext): Promise<void> {
    this.config = context.config as unknown as MercadoPagoConfig;
    this.initialized = true;
  }
  async activate(): Promise<void> {
    this.active = true;
  }
  async deactivate(): Promise<void> {
    this.active = false;
  }
  async shutdown(): Promise<void> {
    this.initialized = false;
    this.active = false;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    return { paymentId: `mp_${request.reference ?? 'anon'}`, status: PaymentStatus.Pending };
  }
  async getPaymentStatus(_paymentId: string): Promise<PaymentStatus> {
    return PaymentStatus.Paid;
  }
  async createPreference(request: MercadoPagoPreferenceRequest): Promise<MercadoPagoPreference> {
    return {
      preferenceId: `pref_${request.externalReference}`,
      initPoint: `https://mp.test/checkout/${request.externalReference}`,
    };
  }

  /** Exposes the resolved access token source for assertions (never a real secret). */
  get accessToken(): string {
    return this.config.accessToken;
  }
}

/** A fake AFIP fiscal integration (dedicated FiscalPlugin category, no webhooks). */
class FakeAfip implements AfipIntegration {
  public readonly metadata: PluginMetadata = {
    id: 'afip',
    name: 'AFIP',
    version: '1.0.0',
    // AFIP implements the dedicated FiscalPlugin contract (not PaymentPlugin).
    // PluginType has no fiscal category yet, so this fake indexes it under
    // Payment for the registry only; the CONTRACT it satisfies is FiscalPlugin.
    type: PluginType.Payment,
  };
  public readonly cuit = '20111111112';

  async initialize(_context: PluginContext): Promise<void> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async authorizeInvoice(
    request: InvoiceAuthorizationRequest,
  ): Promise<InvoiceAuthorizationResult> {
    return {
      status: InvoiceAuthorizationStatus.Authorized,
      cae: `CAE-${request.invoiceId}`,
      caeExpiry: '2099-12-31',
    };
  }
  async getInvoiceStatus(_invoiceId: string): Promise<InvoiceAuthorizationStatus> {
    return InvoiceAuthorizationStatus.Authorized;
  }
}

/** A fake OpenAI integration (AIPlugin surface). */
class FakeOpenAi implements OpenAiIntegration {
  public readonly metadata: PluginMetadata = {
    id: 'openai',
    name: 'OpenAI',
    version: '1.0.0',
    type: PluginType.AI,
  };
  public readonly model = 'gpt-4o';

  async initialize(_context: PluginContext): Promise<void> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    return { text: `completion:${request.prompt}` };
  }
  async analyze(request: AIAnalysisRequest): Promise<AIAnalysisResult> {
    return { summary: `analyzed ${request.data.length} rows` };
  }
}

/** A fake OCR integration (dedicated OcrPlugin category). */
class FakeOcr implements OcrIntegration {
  public readonly metadata: PluginMetadata = {
    id: 'ocr',
    name: 'OCR',
    version: '1.0.0',
    type: PluginType.AI,
  };
  public readonly engine = 'test-engine';

  async initialize(_context: PluginContext): Promise<void> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async extract(request: OcrRequest): Promise<OcrResult> {
    return { text: `bytes:${request.content.length}`, confidence: 0.99 };
  }
}

/**
 * A fake webhook receiver: "verifies" a shared secret header, parses a JSON
 * body, and derives an idempotency key from the vendor event id.
 */
class FakeSignatureReceiver implements IWebhookReceiver {
  constructor(public readonly source: string) {}

  verifySignature(request: WebhookRequest): WebhookVerificationResult {
    const signature = request.headers['x-signature'];
    return signature === 'valid'
      ? { verified: true }
      : { verified: false, reason: 'bad-signature' };
  }

  parseEvent(request: WebhookRequest): WebhookEvent {
    const parsed = JSON.parse(request.rawBody) as { id: string; type: string };
    const event: WebhookEvent = {
      id: parsed.id,
      type: parsed.type,
      idempotencyKey: parsed.id,
      payload: parsed,
      receivedAt: request.receivedAt ?? new Date(),
    };
    return event;
  }

  idempotencyKeyFor(event: WebhookEvent): string {
    return event.id ?? `${event.type}:${event.receivedAt.toISOString()}`;
  }
}

describe('external-service integration contracts (task 35.3)', () => {
  it('registers integrations through the plugin registry seam, indexed by type', () => {
    const registry = new PluginRegistry();
    const mercadopago = new FakeMercadoPago();
    const openai = new FakeOpenAi();
    const ocr = new FakeOcr();

    registry.register(mercadopago);
    registry.register(openai);
    registry.register(ocr);

    // A concrete adapter is resolved through the same registry seam as any plugin.
    expect(registry.get<PaymentPlugin>('mercadopago')).toBe(mercadopago);
    expect(registry.listByType(PluginType.Payment)).toContain(mercadopago);
    expect(registry.listByType(PluginType.AI)).toEqual(
      expect.arrayContaining([openai, ocr]),
    );
    expect(registry.size).toBe(3);
  });

  it('MercadoPago integration satisfies PaymentPlugin + adds the preference flow', async () => {
    const mp = new FakeMercadoPago();
    // Base plugin lifecycle.
    await mp.initialize({ logger: noopLogger, config: { accessToken: 'from-remote-config' } });
    await mp.activate();
    expect(mp.initialized).toBe(true);
    expect(mp.active).toBe(true);
    // Config is resolved at load time, never hard-coded.
    expect(mp.accessToken).toBe('from-remote-config');

    // Base PaymentPlugin surface.
    const payment = await mp.createPayment({
      amount: { value: 1000, currency: 'ARS' },
      reference: 'sale-1',
    });
    expect(payment.paymentId).toBe('mp_sale-1');
    expect(await mp.getPaymentStatus(payment.paymentId)).toBe(PaymentStatus.Paid);

    // Vendor-specific Checkout Pro preference.
    const pref = await mp.createPreference({
      amount: { value: 1000, currency: 'ARS' },
      externalReference: 'sale-1',
    });
    expect(pref.preferenceId).toBe('pref_sale-1');
    expect(pref.initPoint).toContain('sale-1');
  });

  it('AFIP integration authorizes invoices via the dedicated FiscalPlugin contract', async () => {
    const afip = new FakeAfip();
    const result = await afip.authorizeInvoice({
      invoiceId: 'inv-1',
      invoiceType: 'FA',
      total: { value: 5000, currency: 'ARS' },
    });
    expect(result.status).toBe(InvoiceAuthorizationStatus.Authorized);
    expect(result.cae).toBe('CAE-inv-1');
    expect(await afip.getInvoiceStatus('inv-1')).toBe(InvoiceAuthorizationStatus.Authorized);
  });

  it('AI + OCR integrations satisfy their contracts', async () => {
    const openai = new FakeOpenAi();
    const completion = await openai.complete({ prompt: 'hola' });
    expect(completion.text).toBe('completion:hola');
    const analysis = await openai.analyze({ data: [{ x: 1 }, { x: 2 }] });
    expect(analysis.summary).toContain('2 rows');

    const ocr = new FakeOcr();
    const extracted = await ocr.extract({
      content: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    });
    expect(extracted.text).toBe('bytes:3');
    expect(extracted.confidence).toBe(0.99);
  });

  it('webhook receiver verifies, parses and derives idempotency keys', () => {
    const receiver = new FakeMercadoPago().webhookReceiver;
    const rawBody = JSON.stringify({ id: 'evt_123', type: 'payment.updated' });

    // Invalid signature is rejected and must not be dispatched.
    expect(receiver.verifySignature({ headers: {}, rawBody })).toEqual({
      verified: false,
      reason: 'bad-signature',
    });

    // Valid signature verifies, parses to a uniform envelope, keyed for dedupe.
    const request: WebhookRequest = { headers: { 'x-signature': 'valid' }, rawBody };
    expect(receiver.verifySignature(request)).toEqual({ verified: true });

    const event = receiver.parseEvent(request) as WebhookEvent;
    expect(event.type).toBe('payment.updated');
    expect(event.idempotencyKey).toBe('evt_123');
    expect(receiver.idempotencyKeyFor(event)).toBe('evt_123');
    expect(receiver.source).toBe('mercadopago');
  });
});
