/**
 * E-commerce integration contracts (task 35.3, Requirement 19.2).
 *
 * Prepares the seams for syncing the platform's catalogue and orders with three
 * storefronts: Shopify, WooCommerce (self-hosted WordPress) and Tienda Nube (a
 * Latin-American platform). Every contract extends the base
 * {@link import('../plugin.js').EcommercePlugin} product/order sync surface and
 * adds vendor-specific config + capabilities. Interface-only; no vendor SDK is
 * imported and no network call is made.
 */

import type { EcommercePlugin, SyncResult } from '../plugin.js';
import type { IntegrationConfig, WebhookSecretConfig } from './integration.js';
import type { WebhookCapable } from './webhook.js';

/* -------------------------------------------------------------------------- */
/* Shopify                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Configuration for the Shopify integration.
 *
 * Resolved at load time; env var names document each secret's source.
 */
export interface ShopifyConfig extends IntegrationConfig, WebhookSecretConfig {
  /** The store's `*.myshopify.com` domain. Resolved from `SHOPIFY_SHOP_DOMAIN`. */
  readonly shopDomain: string;
  /** Admin API access token. Resolved from `SHOPIFY_ACCESS_TOKEN`. */
  readonly accessToken: string;
  /**
   * Shared secret for verifying the `x-shopify-hmac-sha256` webhook header.
   * Resolved from `SHOPIFY_WEBHOOK_SECRET`.
   */
  readonly webhookSecret?: string;
}

/**
 * Shopify storefront integration (Requirement 19.2).
 *
 * Extends {@link EcommercePlugin}. Webhook-driven for near-real-time order
 * updates (`orders/create`, `orders/updated`) via {@link WebhookCapable.webhookReceiver},
 * verified with `x-shopify-hmac-sha256` against {@link ShopifyConfig.webhookSecret}.
 */
export interface ShopifyIntegration extends EcommercePlugin, WebhookCapable {
  /** The `*.myshopify.com` domain this integration is bound to. */
  readonly shopDomain: string;
}

/* -------------------------------------------------------------------------- */
/* WooCommerce                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Configuration for the WooCommerce integration.
 *
 * WooCommerce is self-hosted, so {@link IntegrationConfig.baseUrl} (the store's
 * WordPress URL) is REQUIRED here. Keys are resolved at load time from the
 * documented env vars.
 */
export interface WooCommerceConfig extends IntegrationConfig {
  /** The store's base URL (required — WooCommerce is self-hosted). Resolved from `WOOCOMMERCE_STORE_URL`. */
  readonly storeUrl: string;
  /** REST API consumer key. Resolved from `WOOCOMMERCE_CONSUMER_KEY`. */
  readonly consumerKey: string;
  /** REST API consumer secret. Resolved from `WOOCOMMERCE_CONSUMER_SECRET`. */
  readonly consumerSecret: string;
}

/**
 * WooCommerce storefront integration (Requirement 19.2).
 *
 * Extends {@link EcommercePlugin}. WooCommerce webhooks are configured per-store
 * and are optional; this contract models the pull-based product/order sync only,
 * so it does not require {@link WebhookCapable}. A concrete adapter MAY add
 * webhook support later without changing this seam.
 */
export interface WooCommerceIntegration extends EcommercePlugin {
  /** The WordPress store URL this integration is bound to. */
  readonly storeUrl: string;
}

/* -------------------------------------------------------------------------- */
/* Tienda Nube                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Configuration for the Tienda Nube integration.
 *
 * Resolved at load time; env var names document each secret's source.
 */
export interface TiendaNubeConfig extends IntegrationConfig, WebhookSecretConfig {
  /** The store id assigned by Tienda Nube. Resolved from `TIENDANUBE_STORE_ID`. */
  readonly storeId: string;
  /** OAuth access token. Resolved from `TIENDANUBE_ACCESS_TOKEN`. */
  readonly accessToken: string;
  /**
   * Shared secret for verifying inbound webhook signatures. Resolved from
   * `TIENDANUBE_WEBHOOK_SECRET`.
   */
  readonly webhookSecret?: string;
}

/**
 * Tienda Nube storefront integration (Requirement 19.2).
 *
 * Extends {@link EcommercePlugin}. Webhook-driven for order/product events via
 * {@link WebhookCapable.webhookReceiver}, verified against
 * {@link TiendaNubeConfig.webhookSecret}.
 */
export interface TiendaNubeIntegration extends EcommercePlugin, WebhookCapable {
  /** The Tienda Nube store id this integration is bound to. */
  readonly storeId: string;
}

/** Re-exported for adapter authors implementing the sync surface. */
export type { SyncResult };
