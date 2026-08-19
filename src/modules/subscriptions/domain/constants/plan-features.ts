/**
 * Canonical feature catalogue and plan → feature mapping.
 *
 * The platform exposes a fixed set of named features. Subscription plans grant
 * access to a subset of these features; the mapping below encodes the
 * plan → feature matrix mandated by Requirement 10.3:
 *
 * - **Starter**: Ventas (sales), Clientes (customers)
 * - **Business**: Starter + Stock, Caja (cash), Reportes (reports)
 * - **Enterprise**: Business + Compras (purchases), API, Sucursales (branches),
 *   Dashboard Avanzado (dashboard), Integraciones (integrations), IA (ai)
 *
 * At runtime the authoritative source of a plan's features is the `features`
 * JSON array persisted on the `Plan` row (Requirement 10.5: plans are
 * configuration-driven and can be added without code changes). This matrix is
 * the canonical reference used to seed those rows and to keep the encoded
 * mapping documented in one place; the feature-access service reads the
 * persisted `plan.features` so new/edited plans are honoured without code
 * changes.
 */

/** All feature keys recognised by the platform. */
export const FEATURES = {
  SALES: 'sales',
  CUSTOMERS: 'customers',
  STOCK: 'stock',
  CASH: 'cash',
  REPORTS: 'reports',
  PURCHASES: 'purchases',
  API: 'api',
  BRANCHES: 'branches',
  DASHBOARD: 'dashboard',
  INTEGRATIONS: 'integrations',
  /**
   * AI Integration features (task 37.3, Requirement 20.1): the sales assistant,
   * natural-language query and AI report-generation endpoints. Granted to the
   * Enterprise tier ONLY, so the AI endpoints are refused with a 403 for any
   * tenant on a lower plan.
   */
  AI: 'ai',
} as const;

/** Union of all valid feature keys. */
export type FeatureName = (typeof FEATURES)[keyof typeof FEATURES];

/** Canonical plan names supported by the platform (Requirement 10.1). */
export const PLAN_NAMES = {
  STARTER: 'starter',
  BUSINESS: 'business',
  ENTERPRISE: 'enterprise',
} as const;

/** Union of all canonical plan names. */
export type PlanName = (typeof PLAN_NAMES)[keyof typeof PLAN_NAMES];

const STARTER_FEATURES: readonly FeatureName[] = [FEATURES.SALES, FEATURES.CUSTOMERS];

const BUSINESS_FEATURES: readonly FeatureName[] = [
  ...STARTER_FEATURES,
  FEATURES.STOCK,
  FEATURES.CASH,
  FEATURES.REPORTS,
];

const ENTERPRISE_FEATURES: readonly FeatureName[] = [
  ...BUSINESS_FEATURES,
  FEATURES.PURCHASES,
  FEATURES.API,
  FEATURES.BRANCHES,
  FEATURES.DASHBOARD,
  FEATURES.INTEGRATIONS,
  FEATURES.AI,
];

/**
 * Canonical plan → feature mapping (Requirement 10.3). Used for seeding the
 * `Plan.features` JSON column and as the documented source of truth for the
 * encoded mapping. Plans are cumulative: each tier includes every feature of
 * the tier below it.
 */
export const PLAN_FEATURE_MATRIX: Readonly<Record<PlanName, readonly FeatureName[]>> = {
  [PLAN_NAMES.STARTER]: STARTER_FEATURES,
  [PLAN_NAMES.BUSINESS]: BUSINESS_FEATURES,
  [PLAN_NAMES.ENTERPRISE]: ENTERPRISE_FEATURES,
};
