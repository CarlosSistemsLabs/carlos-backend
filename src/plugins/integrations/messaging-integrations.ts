/**
 * Messaging integration contracts (task 35.3, Requirement 19.2).
 *
 * Prepares the seam for WhatsApp Business messaging. Interface-only: extends the
 * base {@link import('../plugin.js').MessagingPlugin} and adds WhatsApp's
 * template-message surface plus its inbound-webhook capability. No vendor SDK is
 * imported and no network call is made.
 */

import type { MessagingPlugin, MessageResult } from '../plugin.js';
import type { IntegrationConfig, WebhookSecretConfig } from './integration.js';
import type { WebhookCapable } from './webhook.js';

/**
 * Configuration for the WhatsApp Business Cloud API integration.
 *
 * Credentials are resolved at load time; the env var names document their
 * source — the literal tokens never live in source.
 */
export interface WhatsAppConfig extends IntegrationConfig, WebhookSecretConfig {
  /** Permanent access token for the Cloud API. Resolved from `WHATSAPP_ACCESS_TOKEN`. */
  readonly accessToken: string;
  /** The phone-number id messages are sent from. Resolved from `WHATSAPP_PHONE_NUMBER_ID`. */
  readonly phoneNumberId: string;
  /**
   * The token echoed during webhook subscription verification (the
   * `hub.verify_token` challenge). Resolved from `WHATSAPP_VERIFY_TOKEN`.
   */
  readonly verifyToken?: string;
  /**
   * App secret used to verify the `x-hub-signature-256` header on inbound
   * webhooks. Resolved from `WHATSAPP_APP_SECRET`.
   */
  readonly webhookSecret?: string;
}

/**
 * A WhatsApp template message. Outside the 24-hour customer-service window,
 * WhatsApp only permits pre-approved TEMPLATE messages, so the template flow is
 * modelled explicitly rather than folded into free-form {@link MessagingPlugin.sendMessage}.
 */
export interface WhatsAppTemplateMessage {
  /** Recipient phone number in E.164 format (e.g. `+5491122334455`). */
  readonly to: string;
  /** The approved template name. */
  readonly templateName: string;
  /** BCP-47 language code for the template (e.g. `es_AR`). */
  readonly languageCode: string;
  /** Ordered variable substitutions filling the template's placeholders. */
  readonly parameters?: readonly string[];
}

/**
 * WhatsApp Business messaging integration (Requirement 19.2).
 *
 * Extends {@link MessagingPlugin} for free-form session messages and adds the
 * template-message flow. Inbound messages and delivery statuses arrive via
 * {@link WebhookCapable.webhookReceiver}, verified with `x-hub-signature-256`
 * against {@link WhatsAppConfig.webhookSecret}.
 */
export interface WhatsAppIntegration extends MessagingPlugin, WebhookCapable {
  /** Sends a pre-approved template message (valid outside the 24h session window). */
  sendTemplate(message: WhatsAppTemplateMessage): Promise<MessageResult>;
}
