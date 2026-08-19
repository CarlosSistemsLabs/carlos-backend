/**
 * Plugin and Integration System — core contracts (task 35.1, Requirements
 * 19.1, 19.4).
 *
 * The Plugin System lets external integrations (payment processors, messaging
 * services, e-commerce platforms, reporting tools, AI services) plug into the
 * platform through stable INTERFACE CONTRACTS, without the domain layer ever
 * depending on a vendor SDK (Requirement 19.1). Concrete adapters such as
 * Mercado Pago, Stripe, WhatsApp, Shopify or OpenAI (Requirement 19.2) are the
 * subject of later tasks; this module defines only the abstractions they
 * implement.
 *
 * Every plugin implements the {@link IPlugin} lifecycle and declares its
 * {@link PluginType}; type-specific sub-interfaces ({@link PaymentPlugin},
 * {@link MessagingPlugin}, {@link EcommercePlugin}, {@link ReportingPlugin},
 * {@link AIPlugin}) add the minimal capability surface for that category
 * (Requirement 19.4). Loading/discovery and per-tenant activation are layered
 * on top by task 35.2; concrete external-service interfaces are task 35.3.
 */

/**
 * The category of external service a plugin integrates with (Requirement 19.4).
 *
 * The registry indexes plugins by this discriminator so callers can resolve
 * "the active payment plugin" without knowing the concrete vendor.
 */
export const PluginType = {
  /** Payment processors (e.g. Mercado Pago, Stripe). */
  Payment: 'payment',
  /** Messaging services (e.g. WhatsApp, SMS, email). */
  Messaging: 'messaging',
  /** E-commerce platforms (e.g. Shopify, WooCommerce, Tienda Nube). */
  Ecommerce: 'ecommerce',
  /** Reporting / BI tools (e.g. Power BI). */
  Reporting: 'reporting',
  /** AI services / LLM providers (e.g. OpenAI, Claude, Gemini). */
  AI: 'ai',
} as const;

/** Union of all valid {@link PluginType} values. */
export type PluginType = (typeof PluginType)[keyof typeof PluginType];

/**
 * Immutable descriptor every plugin exposes so the registry, diagnostics and
 * per-tenant activation (task 35.2) can identify and route to it without
 * inspecting its implementation.
 */
export interface PluginMetadata {
  /**
   * Stable, unique identifier for the plugin (e.g. `'mercadopago'`). Serves as
   * the registry key; duplicate ids are rejected on registration.
   */
  readonly id: string;
  /** Human-readable display name (e.g. `'Mercado Pago'`). */
  readonly name: string;
  /** Semantic version of the plugin implementation (e.g. `'1.0.0'`). */
  readonly version: string;
  /** The category this plugin integrates with (Requirement 19.4). */
  readonly type: PluginType;
  /** Optional short description of what the plugin does. */
  readonly description?: string;
}

/**
 * The structural subset of a logger a plugin depends on at runtime.
 *
 * Declared locally so the plugin contracts take no hard dependency on pino;
 * Fastify's `app.log`/`request.log` and the application root logger satisfy it,
 * mirroring the analytics module's `AnalyticsLogger`. A failing plugin must be
 * observable (Requirement 19.5) without coupling the contract to a concrete
 * logging framework.
 */
export interface PluginLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Everything a plugin is handed when it initializes, kept intentionally
 * abstract so the contract never pulls in concrete infrastructure
 * (Requirement 19.1).
 *
 * The context carries a logger for observability, an opaque configuration
 * record (credentials, endpoints, options — resolved by the loader in task
 * 35.2, typically from per-tenant secrets/feature flags) and an optional tenant
 * scope. Plugins read from the context but never reach back into domain
 * modules directly.
 */
export interface PluginContext {
  /** Logger for the plugin to record lifecycle and operational events. */
  readonly logger: PluginLogger;
  /**
   * Opaque configuration for the plugin instance (credentials, endpoints,
   * feature toggles). The shape is plugin-specific; the contract keeps it a
   * read-only record so no vendor type leaks into the core.
   */
  readonly config: Readonly<Record<string, unknown>>;
  /**
   * The tenant this plugin instance is scoped to, when activation is
   * per-tenant (Requirement 19.6). Absent for platform-wide plugins. Kept as an
   * opaque identifier so the contract stays free of the tenancy implementation.
   */
  readonly tenantId?: string;
}

/**
 * Base contract implemented by every plugin (Requirement 19.1).
 *
 * ## Lifecycle state machine
 *
 * A plugin moves through four well-defined async phases; the registry (task
 * 35.1) only tracks registration, while the loader/activation layer (task 35.2)
 * drives these transitions:
 *
 * ```
 *   (registered)
 *        │  initialize(context)   ── one-time setup: read config, build clients
 *        ▼
 *    initialized
 *        │  activate()            ── begin serving (per tenant, Requirement 19.6)
 *        ▼
 *      active  ⇄  inactive        ── activate() / deactivate() may toggle
 *        │  shutdown()            ── terminal: release all resources
 *        ▼
 *     shut down
 * ```
 *
 * Invariants:
 * - `initialize` runs exactly once before any `activate`.
 * - `activate`/`deactivate` may be called repeatedly to toggle per-tenant
 *   availability without re-initializing.
 * - `shutdown` is terminal; the instance must not be reused afterwards.
 * - Every method is async and MUST NOT throw for recoverable conditions in a
 *   way that breaks the host: a failing plugin is logged and isolated so core
 *   operation continues (Requirement 19.5).
 */
export interface IPlugin {
  /** Immutable descriptor identifying this plugin (see {@link PluginMetadata}). */
  readonly metadata: PluginMetadata;

  /**
   * One-time initialization: read {@link PluginContext.config}, construct any
   * clients, and validate prerequisites. Runs once before {@link activate}.
   *
   * @param context - Logger, configuration and optional tenant scope.
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Transitions the plugin to the active state so it begins serving requests.
   * Safe to call again after {@link deactivate} to re-enable the plugin (e.g.
   * when a tenant re-enables the integration via a feature flag,
   * Requirement 19.6).
   */
  activate(): Promise<void>;

  /**
   * Transitions the plugin to the inactive state, pausing request handling
   * while retaining initialized resources. Reversible via {@link activate}.
   */
  deactivate(): Promise<void>;

  /**
   * Terminal teardown: release every resource acquired during
   * {@link initialize} (connections, timers, clients). The instance must not be
   * used after this resolves.
   */
  shutdown(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Type-specific plugin contracts (Requirement 19.4)                          */
/*                                                                            */
/* Each contract below is intentionally THIN — a minimal, EXTENSIBLE surface  */
/* for a category of integration. Concrete vendor interfaces (task 35.3) add  */
/* the remaining detail; these stay free of vendor SDK types.                 */
/* -------------------------------------------------------------------------- */

/** Domain-friendly monetary amount used across plugin payloads. */
export interface MonetaryAmount {
  /** Amount in the currency's minor-unit-agnostic decimal form (e.g. `1000.5`). */
  readonly value: number;
  /** ISO-4217 currency code (e.g. `'ARS'`, `'USD'`). */
  readonly currency: string;
}

/** Coarse lifecycle status of a payment, abstracted over vendor vocabularies. */
export const PaymentStatus = {
  Pending: 'pending',
  Authorized: 'authorized',
  Paid: 'paid',
  Failed: 'failed',
  Refunded: 'refunded',
  Cancelled: 'cancelled',
} as const;

/** Union of all valid {@link PaymentStatus} values. */
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** Request to create a payment through a {@link PaymentPlugin}. */
export interface PaymentRequest {
  /** The amount to charge. */
  readonly amount: MonetaryAmount;
  /** Caller-side reference (e.g. a sale id) for reconciliation. */
  readonly reference?: string;
  /** Optional human-readable description shown to the payer. */
  readonly description?: string;
  /** Opaque, vendor-agnostic extra parameters. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Outcome of creating a payment. */
export interface PaymentResult {
  /** The provider-assigned payment identifier. */
  readonly paymentId: string;
  /** The current status of the payment. */
  readonly status: PaymentStatus;
  /** Optional URL the payer must visit to complete the payment. */
  readonly redirectUrl?: string;
}

/**
 * Contract for payment-processor integrations (e.g. Mercado Pago, Stripe).
 * Deliberately minimal — richer flows (refunds, webhooks) are added by concrete
 * adapters in later tasks.
 */
export interface PaymentPlugin extends IPlugin {
  /** Initiates a payment and returns its identifier + initial status. */
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
  /** Reads the current status of a previously created payment. */
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
}

/** A message to deliver through a {@link MessagingPlugin}. */
export interface MessageRequest {
  /** Recipient address (phone number, chat id, email — channel-specific). */
  readonly to: string;
  /** The message body. */
  readonly body: string;
  /** Opaque, channel-specific extra parameters. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Outcome of sending a message. */
export interface MessageResult {
  /** The provider-assigned message identifier, when available. */
  readonly messageId?: string;
  /** Whether the provider accepted the message for delivery. */
  readonly accepted: boolean;
}

/**
 * Contract for messaging-service integrations (e.g. WhatsApp, SMS, email).
 */
export interface MessagingPlugin extends IPlugin {
  /** Sends a message to a recipient. */
  sendMessage(message: MessageRequest): Promise<MessageResult>;
}

/** Summary of a synchronization run performed by an {@link EcommercePlugin}. */
export interface SyncResult {
  /** Number of records created during the sync. */
  readonly created: number;
  /** Number of records updated during the sync. */
  readonly updated: number;
  /** Number of records skipped (unchanged or filtered out). */
  readonly skipped: number;
}

/**
 * Contract for e-commerce platform integrations (e.g. Shopify, WooCommerce,
 * Tienda Nube). Synchronizes the platform's catalogue and orders with an
 * external storefront.
 */
export interface EcommercePlugin extends IPlugin {
  /** Synchronizes products between the platform and the storefront. */
  syncProducts(): Promise<SyncResult>;
  /** Synchronizes orders between the storefront and the platform. */
  syncOrders(): Promise<SyncResult>;
}

/** Output formats a {@link ReportingPlugin} may export to. */
export const ReportExportFormat = {
  Pdf: 'pdf',
  Csv: 'csv',
  Xlsx: 'xlsx',
  Json: 'json',
} as const;

/** Union of all valid {@link ReportExportFormat} values. */
export type ReportExportFormat = (typeof ReportExportFormat)[keyof typeof ReportExportFormat];

/** Request to export a report through a {@link ReportingPlugin}. */
export interface ReportExportRequest {
  /** Identifier of the report to export. */
  readonly reportId: string;
  /** The desired output format. */
  readonly format: ReportExportFormat;
  /** Opaque report parameters (date ranges, filters). */
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Result of exporting a report. */
export interface ReportExportResult {
  /** The format the report was produced in. */
  readonly format: ReportExportFormat;
  /** A URL to the produced artifact, when the tool returns one. */
  readonly url?: string;
}

/**
 * Contract for reporting / BI tool integrations (e.g. Power BI). Exports the
 * platform's reports to an external tool or downloadable artifact.
 */
export interface ReportingPlugin extends IPlugin {
  /** Exports a report in the requested format. */
  export(request: ReportExportRequest): Promise<ReportExportResult>;
}

/** Request for an AI text completion. */
export interface AICompletionRequest {
  /** The prompt to complete. */
  readonly prompt: string;
  /** Optional upper bound on generated tokens. */
  readonly maxTokens?: number;
  /** Optional sampling temperature. */
  readonly temperature?: number;
}

/** Result of an AI text completion. */
export interface AICompletionResult {
  /** The generated text. */
  readonly text: string;
}

/** Request for an AI analysis over a dataset. */
export interface AIAnalysisRequest {
  /** The records to analyze (e.g. sales rows). */
  readonly data: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Optional instruction describing the desired analysis. */
  readonly instruction?: string;
}

/** Result of an AI analysis. */
export interface AIAnalysisResult {
  /** A natural-language summary of the analysis. */
  readonly summary: string;
  /** Optional structured insights extracted from the data. */
  readonly insights?: Readonly<Record<string, unknown>>;
}

/**
 * Contract for AI-service integrations (e.g. OpenAI, Claude, Gemini). Keeps the
 * domain free of any LLM SDK (Requirement 20.3) behind a small completion +
 * analysis surface.
 */
export interface AIPlugin extends IPlugin {
  /** Produces a text completion for a prompt. */
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
  /** Analyzes a dataset and returns a summary + optional insights. */
  analyze(request: AIAnalysisRequest): Promise<AIAnalysisResult>;
}
