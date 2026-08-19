/**
 * Payment- and fiscal-authority integration contracts (task 35.3,
 * Requirement 19.2).
 *
 * Prepares the seams for Argentina-first payment processing (Mercado Pago),
 * international card processing (Stripe) and electronic tax invoicing (AFIP).
 * Every contract here is an INTERFACE only — it extends the appropriate base
 * plugin from {@link import('../plugin.js')} and adds the vendor-specific
 * capability surface plus a typed config. No vendor SDK is imported and no
 * network call is made; concrete adapters are a later task.
 */

import type { PaymentPlugin, IPlugin, MonetaryAmount } from '../plugin.js';
import type { IntegrationConfig, WebhookSecretConfig } from './integration.js';
import type { WebhookCapable } from './webhook.js';

/* -------------------------------------------------------------------------- */
/* Mercado Pago (payment processor)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Configuration for the Mercado Pago integration.
 *
 * Credentials are resolved at load time via the
 * {@link import('../plugin-loader.js').PluginConfigResolver}; the env var names below document where
 * each value comes from — the literal secrets never live in source.
 */
export interface MercadoPagoConfig extends IntegrationConfig, WebhookSecretConfig {
  /** Server-side access token. Resolved from `MERCADOPAGO_ACCESS_TOKEN`. */
  readonly accessToken: string;
  /** Client-side public key for the checkout brick. Resolved from `MERCADOPAGO_PUBLIC_KEY`. */
  readonly publicKey?: string;
}

/** A Checkout Pro preference — the redirect-based payment intent Mercado Pago uses. */
export interface MercadoPagoPreferenceRequest {
  /** The amount to charge. */
  readonly amount: MonetaryAmount;
  /** Caller-side reference (e.g. a sale id) echoed back on the webhook. */
  readonly externalReference: string;
  /** Optional description shown on the checkout. */
  readonly description?: string;
}

/** The created Checkout Pro preference. */
export interface MercadoPagoPreference {
  /** The preference id assigned by Mercado Pago. */
  readonly preferenceId: string;
  /** The hosted checkout URL the payer is redirected to. */
  readonly initPoint: string;
}

/**
 * Mercado Pago payment integration (Requirement 19.2).
 *
 * Extends {@link PaymentPlugin} for the common create/status surface and adds
 * Mercado Pago's redirect-based Checkout Pro preference flow. Webhook-driven:
 * payment state changes arrive via {@link WebhookCapable.webhookReceiver}
 * (topic `payment`), verified against {@link MercadoPagoConfig.webhookSecret}.
 */
export interface MercadoPagoIntegration extends PaymentPlugin, WebhookCapable {
  /** Creates a Checkout Pro preference and returns its hosted checkout URL. */
  createPreference(request: MercadoPagoPreferenceRequest): Promise<MercadoPagoPreference>;
}

/* -------------------------------------------------------------------------- */
/* Stripe (payment processor)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Configuration for the Stripe integration.
 *
 * Resolved at load time; env var names document the source of each secret.
 */
export interface StripeConfig extends IntegrationConfig, WebhookSecretConfig {
  /** Secret API key. Resolved from `STRIPE_SECRET_KEY`. */
  readonly secretKey: string;
  /** Publishable key for the client. Resolved from `STRIPE_PUBLISHABLE_KEY`. */
  readonly publishableKey?: string;
  /**
   * Signing secret for the `stripe-signature` header. Resolved from
   * `STRIPE_WEBHOOK_SECRET` (overrides {@link WebhookSecretConfig.webhookSecret}
   * documentation for Stripe specifically).
   */
  readonly webhookSecret?: string;
}

/** A Stripe PaymentIntent — Stripe's confirmable payment object. */
export interface StripePaymentIntent {
  /** The PaymentIntent id (`pi_...`). */
  readonly paymentIntentId: string;
  /** The client secret the frontend uses to confirm the intent. */
  readonly clientSecret: string;
}

/**
 * Stripe payment integration (Requirement 19.2).
 *
 * Extends {@link PaymentPlugin} and adds Stripe's PaymentIntent creation. Webhook
 * events (`payment_intent.succeeded`, etc.) arrive via
 * {@link WebhookCapable.webhookReceiver}, verified with the `stripe-signature`
 * header against {@link StripeConfig.webhookSecret}.
 */
export interface StripeIntegration extends PaymentPlugin, WebhookCapable {
  /** Creates a PaymentIntent and returns its client secret for confirmation. */
  createPaymentIntent(amount: MonetaryAmount, reference?: string): Promise<StripePaymentIntent>;
}

/* -------------------------------------------------------------------------- */
/* AFIP (Argentine tax authority — electronic invoicing)                      */
/* -------------------------------------------------------------------------- */

/**
 * A tax-authority / fiscal integration contract.
 *
 * AFIP (Administración Federal de Ingresos Públicos) is Argentina's tax
 * authority. Its integration is NOT a payment processor: it AUTHORIZES
 * electronic invoices, returning a CAE (Código de Autorización Electrónico) and
 * its expiry, rather than moving money. Modelling it as a {@link PaymentPlugin}
 * would misrepresent its capability surface (there is no `createPayment`), so we
 * define a dedicated {@link FiscalPlugin} category contract extending the base
 * {@link IPlugin} lifecycle instead. This keeps the payment category honest and
 * gives fiscal authorities their own stable seam (Requirement 19.4).
 */
export interface FiscalPlugin extends IPlugin {
  /** Requests electronic authorization (CAE) for an invoice. */
  authorizeInvoice(request: InvoiceAuthorizationRequest): Promise<InvoiceAuthorizationResult>;
  /** Reads the authorization status of a previously submitted invoice. */
  getInvoiceStatus(invoiceId: string): Promise<InvoiceAuthorizationStatus>;
}

/** Coarse status of an electronic-invoice authorization, abstracted over AFIP vocabularies. */
export const InvoiceAuthorizationStatus = {
  /** Submitted, awaiting the authority's response. */
  Pending: 'pending',
  /** Authorized: a CAE was granted. */
  Authorized: 'authorized',
  /** Rejected by the authority (observations returned). */
  Rejected: 'rejected',
} as const;

/** Union of all valid {@link InvoiceAuthorizationStatus} values. */
export type InvoiceAuthorizationStatus =
  (typeof InvoiceAuthorizationStatus)[keyof typeof InvoiceAuthorizationStatus];

/** A request to authorize an electronic invoice with the tax authority. */
export interface InvoiceAuthorizationRequest {
  /** Caller-side invoice identifier for reconciliation. */
  readonly invoiceId: string;
  /** The invoice type/point-of-sale code required by the authority. */
  readonly invoiceType: string;
  /** The buyer's tax id (CUIT/CUIL/DNI), when applicable. */
  readonly buyerTaxId?: string;
  /** The total invoiced amount. */
  readonly total: MonetaryAmount;
}

/** The tax authority's authorization outcome for an invoice. */
export interface InvoiceAuthorizationResult {
  /** The resulting status. */
  readonly status: InvoiceAuthorizationStatus;
  /** The CAE (authorization code) granted when {@link status} is `authorized`. */
  readonly cae?: string;
  /** The CAE expiry date (`YYYY-MM-DD`), present when authorized. */
  readonly caeExpiry?: string;
  /** Authority observations/rejection reasons, when present. */
  readonly observations?: readonly string[];
}

/**
 * Configuration for the AFIP integration.
 *
 * AFIP authenticates with a WSAA certificate + private key (not a simple API
 * key). Both are resolved as PEM strings from the Remote Config secret store at
 * load time — never embedded in source.
 */
export interface AfipConfig extends IntegrationConfig {
  /** The taxpayer CUIT the platform invoices on behalf of. Resolved from `AFIP_CUIT`. */
  readonly cuit: string;
  /** WSAA X.509 certificate (PEM). Resolved from `AFIP_CERT_PEM` (secret store). */
  readonly certificatePem: string;
  /** WSAA private key (PEM). Resolved from `AFIP_PRIVATE_KEY_PEM` (secret store). */
  readonly privateKeyPem: string;
}

/**
 * AFIP electronic-invoicing integration (Requirement 19.2).
 *
 * Implements the {@link FiscalPlugin} contract (see the rationale above for why
 * this is a fiscal, not payment, category). Request/response only — AFIP is not
 * webhook-driven, so this integration does not implement {@link WebhookCapable}.
 */
export interface AfipIntegration extends FiscalPlugin {
  /** The taxpayer CUIT this integration invoices on behalf of. */
  readonly cuit: string;
}
