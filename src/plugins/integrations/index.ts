/**
 * External-service integration contracts (task 35.3, Requirement 19.2).
 *
 * Barrel for the typed, vendor-specific integration SEAMS the platform prepares
 * to bind concrete adapters into. Every export here is an INTERFACE or TYPE —
 * there is no runtime vendor code — so importing this module never pulls a
 * vendor SDK into the build. See `./README.md` for how a concrete adapter binds
 * via the {@link import('../plugin-loader.js').PluginFactory} seam + the per-tenant
 * `plugin:{id}` feature flag.
 */

/* Shared foundations */
export { IntegrationEnvironment } from './integration.js';
export type { IntegrationConfig, WebhookSecretConfig } from './integration.js';

/* Webhook handling contract */
export type {
  WebhookRequest,
  WebhookVerificationResult,
  WebhookEvent,
  IWebhookReceiver,
  WebhookHandler,
  WebhookCapable,
} from './webhook.js';

/* Payment + fiscal */
export { InvoiceAuthorizationStatus } from './payment-integrations.js';
export type {
  MercadoPagoConfig,
  MercadoPagoPreferenceRequest,
  MercadoPagoPreference,
  MercadoPagoIntegration,
  StripeConfig,
  StripePaymentIntent,
  StripeIntegration,
  FiscalPlugin,
  InvoiceAuthorizationRequest,
  InvoiceAuthorizationResult,
  AfipConfig,
  AfipIntegration,
} from './payment-integrations.js';

/* Messaging */
export type {
  WhatsAppConfig,
  WhatsAppTemplateMessage,
  WhatsAppIntegration,
} from './messaging-integrations.js';

/* Ecommerce */
export type {
  ShopifyConfig,
  ShopifyIntegration,
  WooCommerceConfig,
  WooCommerceIntegration,
  TiendaNubeConfig,
  TiendaNubeIntegration,
} from './ecommerce-integrations.js';

/* Reporting */
export type {
  PowerBiConfig,
  PowerBiDatasetRows,
  PowerBiEmbedToken,
  PowerBiIntegration,
} from './reporting-integrations.js';

/* AI + OCR */
export type {
  LlmProviderConfig,
  OpenAiConfig,
  OpenAiIntegration,
  ClaudeConfig,
  ClaudeIntegration,
  GeminiConfig,
  GeminiIntegration,
  OcrPlugin,
  OcrRequest,
  OcrResult,
  OcrConfig,
  OcrIntegration,
} from './ai-integrations.js';
