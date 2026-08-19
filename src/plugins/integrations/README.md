# External-Service Integration Contracts (task 35.3)

> **Requirement 19.2** — the Plugin System SHALL support future integrations:
> Mercado Pago, Stripe, AFIP, WhatsApp, Shopify, WooCommerce, Tienda Nube,
> Power BI, OpenAI, Claude, Gemini, OCR.

This module defines the **typed interface contracts (seams)** for those future
integrations. It is **preparation, not live integration**: there are no vendor
SDKs, no network calls, and no registered routes. Every export is an
`interface`/`type`, so importing it never pulls a vendor dependency into the
build. Concrete adapters are wired in later tasks behind the seams described
here.

Each integration:

- **extends the matching base plugin contract** from `../plugin.ts`
  (`PaymentPlugin`, `MessagingPlugin`, `EcommercePlugin`, `ReportingPlugin`,
  `AIPlugin`) — or a dedicated category contract when the base does not fit
  (see AFIP and OCR below);
- declares a **typed config interface** whose fields hold credentials/endpoints
  resolved **at load time** from environment variables or the Remote Config
  secret store via the loader's `PluginConfigResolver`. **No secret is ever
  hard-coded**; each config field documents the env var name it comes from.

## Integration points by category

| Integration    | Category   | Base contract  | Vendor-specific surface                         | Webhook-driven |
| -------------- | ---------- | -------------- | ----------------------------------------------- | -------------- |
| Mercado Pago   | Payment    | `PaymentPlugin`  | `createPreference` (Checkout Pro)             | Yes            |
| Stripe         | Payment    | `PaymentPlugin`  | `createPaymentIntent`                         | Yes            |
| AFIP           | Fiscal     | `FiscalPlugin`\* | `authorizeInvoice` / `getInvoiceStatus` (CAE) | No             |
| WhatsApp       | Messaging  | `MessagingPlugin`| `sendTemplate`                                | Yes            |
| Shopify        | Ecommerce  | `EcommercePlugin`| `syncProducts` / `syncOrders`                 | Yes            |
| WooCommerce    | Ecommerce  | `EcommercePlugin`| `syncProducts` / `syncOrders`                 | No\*\*         |
| Tienda Nube    | Ecommerce  | `EcommercePlugin`| `syncProducts` / `syncOrders`                 | Yes            |
| Power BI       | Reporting  | `ReportingPlugin`| `pushRows` / `generateEmbedToken`             | No             |
| OpenAI         | AI         | `AIPlugin`       | `complete` / `analyze`                        | No             |
| Claude         | AI         | `AIPlugin`       | `complete` / `analyze`                        | No             |
| Gemini         | AI         | `AIPlugin`       | `complete` / `analyze`                        | No             |
| OCR            | OCR        | `OcrPlugin`\*    | `extract` (image/PDF → text/fields)           | No             |

\* **Dedicated category contracts.** AFIP is Argentina's tax authority: it
**authorizes electronic invoices** (returning a CAE + expiry) rather than moving
money, so it does not fit `PaymentPlugin` (there is no `createPayment`). It
implements a dedicated `FiscalPlugin` contract instead. Likewise OCR takes a
binary document and returns extracted content, which does not fit `AIPlugin`'s
prompt-completion shape, so it implements a dedicated `OcrPlugin` contract. Both
keep their host category honest while still extending the base `IPlugin`
lifecycle (Requirement 19.4).

\*\* WooCommerce webhooks are configured per-store and optional; the contract
models pull-based sync only and can gain `WebhookCapable` later without changing
the seam.

## Required configuration (by env var name — never values)

Values are resolved at load time by `PluginConfigResolver` from the environment
or the Remote Config secret store.

- **Mercado Pago:** `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`,
  `MERCADOPAGO_WEBHOOK_SECRET`
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`
- **AFIP:** `AFIP_CUIT`, `AFIP_CERT_PEM`, `AFIP_PRIVATE_KEY_PEM`
- **WhatsApp:** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`
- **Shopify:** `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`,
  `SHOPIFY_WEBHOOK_SECRET`
- **WooCommerce:** `WOOCOMMERCE_STORE_URL`, `WOOCOMMERCE_CONSUMER_KEY`,
  `WOOCOMMERCE_CONSUMER_SECRET`
- **Tienda Nube:** `TIENDANUBE_STORE_ID`, `TIENDANUBE_ACCESS_TOKEN`,
  `TIENDANUBE_WEBHOOK_SECRET`
- **Power BI:** `POWERBI_TENANT_ID`, `POWERBI_CLIENT_ID`,
  `POWERBI_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`
- **OpenAI:** `OPENAI_API_KEY`, `OPENAI_ORGANIZATION`
- **Claude:** `ANTHROPIC_API_KEY`
- **Gemini:** `GEMINI_API_KEY`
- **OCR:** `OCR_API_KEY`

## Webhook handling

Several integrations (Mercado Pago, Stripe, WhatsApp, Shopify, Tienda Nube) are
**webhook-driven**: the vendor calls back to report state changes. The reusable
`webhook.ts` contracts describe the three responsibilities every inbound
endpoint shares, so a **single generic route** (registered by a later task) can
serve them all:

1. **Verify the signature** — `IWebhookReceiver.verifySignature(request)` runs
   against the **raw, unparsed body** using the integration's configured
   `webhookSecret`. Each vendor uses its own header:
   - Mercado Pago → `x-signature`
   - Stripe → `stripe-signature`
   - WhatsApp → `x-hub-signature-256`
   - Shopify → `x-shopify-hmac-sha256`
   - Tienda Nube → vendor signature header
   A failed verification is rejected (`401`) and the event is **never
   dispatched** — unverified webhooks are treated as hostile input.
2. **Parse the event** — only after verification, `parseEvent(request)`
   normalizes the vendor body into a uniform `WebhookEvent<TPayload>` envelope
   (`type`, `payload`, `receivedAt`, ...).
3. **Idempotency** — `idempotencyKeyFor(event)` derives a stable key (vendor
   event id, or a composite like resource id + status) so **redeliveries are
   processed at most once** (Requirement 19.5). The dispatcher skips a key it has
   already handled before invoking the `WebhookHandler`.

A webhook-driven integration exposes its receiver via `WebhookCapable.webhookReceiver`,
letting the composition root resolve the receiver by `source` (which equals the
plugin id) and dispatch uniformly. **No live route is registered in this task.**

## How a concrete adapter binds

Adapters plug into the **same seams** established by tasks 35.1 and 35.2 — no
domain code changes (Requirement 19.3):

1. **Implement** the integration interface (e.g. a class implementing
   `MercadoPagoIntegration`), importing **only** the type contracts from this
   module — never a vendor type into the core.
2. **Expose it as a `PluginFactory`** (`() => IPlugin`) at the composition root.
   The `PluginLoader` discovers factories, `register`s them into the
   `PluginRegistry`, then drives `initialize(context)` → `activate()`. The
   adapter reads its typed config from `PluginContext.config`, resolved by the
   `PluginConfigResolver` from env / Remote Config.
3. **Gate per tenant** with the `PluginActivationService`, which consults the
   feature flag `plugin:{id}` (e.g. `plugin:mercadopago`) via the Subscriptions
   feature-access mechanism (Requirement 19.6). A tenant only sees an
   integration when its flag is enabled.
4. **(Webhook-driven only)** register the adapter's `webhookReceiver` with the
   generic webhook route so inbound events verify + dispatch to it.

Because everything binds behind these seams, adding a vendor is additive: a new
factory + config + feature flag, with the domain untouched.
