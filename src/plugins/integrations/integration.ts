/**
 * Shared foundations for external-service integration contracts (task 35.3,
 * Requirement 19.2).
 *
 * Every concrete integration extends a category base plugin
 * ({@link import('../plugin.js').PaymentPlugin}, {@link import('../plugin.js').MessagingPlugin}, etc.) AND declares a
 * typed CONFIG interface describing the credentials, endpoints and webhook
 * secrets it needs. This module holds the pieces those config interfaces share.
 *
 * ## Secrets are referenced, never hard-coded
 *
 * A config value in these interfaces holds the RESOLVED value at runtime, but
 * that value is always sourced through the loader's
 * {@link import('../plugin-loader.js').PluginConfigResolver} — from environment variables or the
 * Remote Config store — and NEVER committed. Each field documents the env var
 * name it is resolved from (e.g. `MERCADOPAGO_ACCESS_TOKEN`); the literal
 * secret never appears in source.
 */

/** The vendor environment an integration targets. */
export const IntegrationEnvironment = {
  /** The vendor's test/sandbox environment (no real money / side effects). */
  Sandbox: 'sandbox',
  /** The vendor's live production environment. */
  Production: 'production',
} as const;

/** Union of all valid {@link IntegrationEnvironment} values. */
export type IntegrationEnvironment =
  (typeof IntegrationEnvironment)[keyof typeof IntegrationEnvironment];

/**
 * The fields every integration config shares.
 *
 * Concrete configs EXTEND this with their vendor-specific credentials and
 * endpoints. All values are resolved at load time via the
 * {@link import('../plugin-loader.js').PluginConfigResolver}; the shapes here document intent and
 * give the compiler a stable seam, not a place to store secrets.
 */
export interface IntegrationConfig {
  /**
   * Which vendor environment to target. Lets the same adapter run against
   * sandbox in non-prod and live in production without code changes.
   */
  readonly environment?: IntegrationEnvironment;
  /**
   * Optional override for the vendor API base URL, for self-hosted vendors
   * (e.g. WooCommerce) or vendor sandboxes. Defaults to the vendor's documented
   * endpoint when omitted.
   */
  readonly baseUrl?: string;
}

/**
 * A config that carries an inbound-webhook signing secret.
 *
 * Mixed into the config of any webhook-driven integration. The secret is
 * resolved from the documented env var and used by the integration's
 * {@link import('./webhook.js').IWebhookReceiver} to verify inbound requests — it is never logged
 * or echoed.
 */
export interface WebhookSecretConfig {
  /**
   * The shared secret used to verify inbound webhook signatures. Resolved from
   * the vendor-specific env var documented on each config (e.g.
   * `STRIPE_WEBHOOK_SECRET`).
   */
  readonly webhookSecret?: string;
}
