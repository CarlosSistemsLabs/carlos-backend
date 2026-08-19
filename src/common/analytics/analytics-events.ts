/**
 * Canonical analytics event-name catalog (task 33.2, Requirements 13.2 & 13.4).
 *
 * This module is the **single source of truth** for the names of the analytics
 * events the platform emits. Requirement 13.2 mandates consistent event naming
 * (`login_success`, `sale_created`, `product_viewed`, `stock_updated`,
 * `report_generated`, ...) and Requirement 13.4 mandates that the analytics
 * layer be reusable across the Web, Android and iOS clients.
 *
 * **Cross-platform contract.** The backend, web and mobile clients MUST all log
 * the SAME event names so a single analytics dashboard/report can correlate
 * behaviour regardless of platform. On the clients these names are logged via
 * the Firebase Analytics client SDKs; on the backend they are emitted via
 * {@link IAnalyticsService} (see `analytics-service.ts`). To keep every platform
 * in sync the names SHOULD ultimately live in the shared `carlos-api-contracts`
 * repository (alongside the OpenAPI enums/error codes) and be code-generated
 * into each client SDK; this catalog is the backend's authoritative copy of that
 * contract until the contract package publishes it.
 *
 * Event names follow Firebase Analytics conventions: lowercase `snake_case`,
 * <= 40 characters, no spaces — so they can be forwarded to GA4 unchanged.
 */

/**
 * The canonical analytics event names, keyed by a stable UPPER_SNAKE identifier.
 *
 * Frozen and declared `as const` so the string values are immutable and form a
 * closed literal union ({@link AnalyticsEventName}). Add new events here — never
 * inline a raw string at a call site — so the catalog stays the single source of
 * truth.
 */
export const ANALYTICS_EVENTS = {
  /** A user authenticated successfully. */
  LOGIN_SUCCESS: 'login_success',
  /** An authentication attempt was rejected (bad credentials, locked, ...). */
  LOGIN_FAILED: 'login_failed',
  /** A new user account was created. */
  USER_REGISTERED: 'user_registered',
  /** A sale was created/completed. */
  SALE_CREATED: 'sale_created',
  /** An existing sale was cancelled. */
  SALE_CANCELLED: 'sale_cancelled',
  /** A purchase order was created. */
  PURCHASE_CREATED: 'purchase_created',
  /** A product detail was viewed. */
  PRODUCT_VIEWED: 'product_viewed',
  /** A new product was created in the catalogue. */
  PRODUCT_CREATED: 'product_created',
  /** A product's stock balance changed (movement applied). */
  STOCK_UPDATED: 'stock_updated',
  /** A product crossed its low-stock threshold. */
  STOCK_LOW_ALERT: 'stock_low_alert',
  /** A payment was recorded against a sale/purchase. */
  PAYMENT_RECORDED: 'payment_recorded',
  /** A report was generated/exported. */
  REPORT_GENERATED: 'report_generated',
  /** A cash register was opened. */
  CASH_REGISTER_OPENED: 'cash_register_opened',
  /** A cash register was closed/reconciled. */
  CASH_REGISTER_CLOSED: 'cash_register_closed',
  /** A tenant subscribed to a plan. */
  SUBSCRIPTION_CREATED: 'subscription_created',
} as const;

/**
 * The closed union of canonical event-name string values (e.g.
 * `'login_success'`). Use this type wherever an event name is accepted so the
 * compiler rejects typos and off-catalog names.
 */
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** The stable UPPER_SNAKE keys of {@link ANALYTICS_EVENTS}. */
export type AnalyticsEventKey = keyof typeof ANALYTICS_EVENTS;

/**
 * All canonical event names as a readonly array — convenient for validation
 * (e.g. asserting an inbound name is on the catalog) and for tests that assert
 * catalog stability.
 */
export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = Object.freeze(
  Object.values(ANALYTICS_EVENTS),
) as readonly AnalyticsEventName[];

/**
 * Scalar values permitted in an event's properties bag. Constrained to
 * JSON-serializable scalars so every event can be forwarded to a downstream
 * sink (structured log, GA4 Measurement Protocol, BigQuery) without custom
 * serialization.
 */
export type AnalyticsPropertyValue = string | number | boolean | null;

/**
 * A generic, typed properties bag attached to an event (Requirement 13.3 — log
 * relevant properties). Callers pass domain-specific fields (e.g. `sale_id`,
 * `total`, `product_id`); the tenant/user/request correlation fields are added
 * automatically by the service and MUST NOT be duplicated here.
 */
export type AnalyticsProperties = Readonly<Record<string, AnalyticsPropertyValue>>;

/**
 * Returns `true` when `name` is a canonical analytics event name. Useful for
 * validating names that arrive from outside the type system (e.g. client-logged
 * events forwarded to the backend).
 */
export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name);
}
