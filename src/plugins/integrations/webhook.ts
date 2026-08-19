/**
 * Inbound webhook handling contracts for external-service integrations
 * (task 35.3, Requirement 19.2).
 *
 * Many of the external services the platform prepares to integrate with —
 * Mercado Pago, Stripe, WhatsApp, Shopify and others — are WEBHOOK-DRIVEN: the
 * vendor calls back into the platform to report state changes (a payment was
 * approved, a message was delivered, an order was created) rather than the
 * platform polling for them. This module defines the STABLE, REUSABLE contracts
 * a concrete adapter (a later task) implements to receive those callbacks
 * safely, without the domain layer depending on any vendor SDK
 * (Requirement 19.1).
 *
 * These are PREPARATION contracts only: no live HTTP route is registered here.
 * The {@link IWebhookReceiver} describes the three responsibilities every
 * webhook endpoint shares — verify the signature, parse the event, and derive
 * an idempotency key — so a single generic webhook route (documented in this
 * module's README) can verify + dispatch to the relevant integration uniformly.
 */

/**
 * The raw, transport-level shape of an inbound webhook request, kept free of
 * any web-framework type so the contract does not couple to Fastify (or any
 * particular server).
 *
 * Signature verification almost always needs the EXACT bytes the vendor signed,
 * so {@link rawBody} is the unparsed body string; parsing to JSON happens only
 * AFTER the signature is verified.
 */
export interface WebhookRequest {
  /**
   * The inbound HTTP headers, lower-cased by convention. Signature and event
   * metadata (e.g. `x-signature`, `stripe-signature`, `x-hub-signature-256`)
   * are read from here.
   */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /**
   * The exact, unparsed request body. Verification MUST run against these bytes
   * before any JSON parsing, since most schemes sign the raw payload.
   */
  readonly rawBody: string;
  /** When the platform received the request; defaults to "now" when omitted. */
  readonly receivedAt?: Date;
}

/**
 * The outcome of verifying a webhook's authenticity.
 *
 * A negative result MUST cause the receiving route to reject the request
 * (typically `401`) and NEVER dispatch the event — an unverified webhook is
 * treated as hostile input (see {@link content_safety in the module README}).
 */
export interface WebhookVerificationResult {
  /** `true` only when the request's signature matched the configured secret. */
  readonly verified: boolean;
  /** Optional machine-readable reason a verification failed, for diagnostics. */
  readonly reason?: string;
}

/**
 * A normalized inbound webhook event, parsed from a verified
 * {@link WebhookRequest}.
 *
 * The generic `TPayload` lets a concrete integration narrow the vendor payload
 * shape while the envelope fields stay uniform across every source, so the
 * dispatcher can route and de-duplicate without knowing the vendor.
 *
 * @typeParam TPayload - The vendor-specific event body type.
 */
export interface WebhookEvent<TPayload = unknown> {
  /** The vendor-assigned event id, when the vendor supplies one. */
  readonly id?: string;
  /**
   * The vendor's event type discriminator (e.g. `'payment.updated'`,
   * `'messages'`, `'orders/create'`), used to route to the right handler.
   */
  readonly type: string;
  /**
   * A stable key identifying this delivery so repeated deliveries of the SAME
   * event are processed at most once (Requirement 19.5 — a redelivery must not
   * double-apply effects). Derived by {@link IWebhookReceiver.idempotencyKeyFor}.
   */
  readonly idempotencyKey: string;
  /** The parsed vendor payload. */
  readonly payload: TPayload;
  /** When the platform received the originating request. */
  readonly receivedAt: Date;
}

/**
 * The three responsibilities every inbound webhook endpoint shares, expressed
 * as a single reusable contract so one generic route can serve every
 * webhook-driven integration (Requirement 19.2).
 *
 * A concrete adapter (later task) implements this for its vendor; the generic
 * route then, for each request: (1) calls {@link verifySignature} and rejects
 * on failure, (2) calls {@link parseEvent} to normalize the body, (3) uses
 * {@link WebhookEvent.idempotencyKey} to skip already-processed deliveries, then
 * dispatches to the owning integration. No framework type appears in the
 * contract, so the same receiver works under any transport.
 *
 * @typeParam TPayload - The vendor-specific event body type.
 */
export interface IWebhookReceiver<TPayload = unknown> {
  /**
   * A stable identifier for the source system (e.g. `'mercadopago'`,
   * `'stripe'`), matching the owning plugin's {@link import('../plugin.js').PluginMetadata} id so the
   * dispatcher can correlate a receiver with its integration.
   */
  readonly source: string;

  /**
   * Verifies the request's signature against the configured webhook secret.
   * MUST run against {@link WebhookRequest.rawBody} before any parsing.
   *
   * @param request - The raw inbound request.
   * @returns Whether the request is authentic (may be async for HMAC/crypto).
   */
  verifySignature(
    request: WebhookRequest,
  ): Promise<WebhookVerificationResult> | WebhookVerificationResult;

  /**
   * Parses a VERIFIED request into a normalized {@link WebhookEvent}. Callers
   * MUST verify first; parsing an unverified request is a contract violation.
   *
   * @param request - The verified inbound request.
   * @returns The normalized event (may be async).
   */
  parseEvent(request: WebhookRequest): Promise<WebhookEvent<TPayload>> | WebhookEvent<TPayload>;

  /**
   * Derives the idempotency key for an event. Defaults to the vendor event id
   * where available, or a vendor-specific composite (e.g. resource id + status)
   * when it is not, so redeliveries collapse to one logical processing.
   *
   * @param event - The parsed event (its {@link WebhookEvent.idempotencyKey}
   *   may be recomputed/validated here).
   */
  idempotencyKeyFor(event: WebhookEvent<TPayload>): string;
}

/**
 * A handler invoked with a verified, de-duplicated {@link WebhookEvent} to
 * apply its domain effect. The owning integration provides the concrete
 * handler; the generic route only orchestrates verify → parse → dedupe →
 * dispatch.
 *
 * @typeParam TPayload - The vendor-specific event body type.
 * @typeParam TResult - The handler's result type (defaults to `void`).
 */
export type WebhookHandler<TPayload = unknown, TResult = void> = (
  event: WebhookEvent<TPayload>,
) => Promise<TResult>;

/**
 * Marker capability mixed into any integration whose vendor delivers events via
 * webhooks. Exposing the receiver on the integration lets the composition root
 * register a single generic webhook route that resolves the receiver by source
 * and dispatches uniformly (Requirement 19.2).
 *
 * @typeParam TPayload - The vendor-specific event body type.
 */
export interface WebhookCapable<TPayload = unknown> {
  /** The receiver that verifies + parses this integration's inbound webhooks. */
  readonly webhookReceiver: IWebhookReceiver<TPayload>;
}
