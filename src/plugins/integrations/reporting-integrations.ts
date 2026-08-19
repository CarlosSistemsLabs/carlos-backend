/**
 * Reporting / BI integration contracts (task 35.3, Requirement 19.2).
 *
 * Prepares the seam for Microsoft Power BI. Extends the base
 * {@link import('../plugin.js').ReportingPlugin} export surface and adds Power
 * BI's dataset-push + embed-token capabilities. Interface-only; no vendor SDK is
 * imported and no network call is made.
 */

import type { ReportingPlugin } from '../plugin.js';
import type { IntegrationConfig } from './integration.js';

/**
 * Configuration for the Power BI integration.
 *
 * Power BI authenticates via Azure AD (service principal). All secrets are
 * resolved at load time from the documented env vars — never embedded in source.
 */
export interface PowerBiConfig extends IntegrationConfig {
  /** Azure AD tenant id. Resolved from `POWERBI_TENANT_ID`. */
  readonly azureTenantId: string;
  /** Service-principal client id. Resolved from `POWERBI_CLIENT_ID`. */
  readonly clientId: string;
  /** Service-principal client secret. Resolved from `POWERBI_CLIENT_SECRET`. */
  readonly clientSecret: string;
  /** The Power BI workspace (group) id datasets/reports live in. Resolved from `POWERBI_WORKSPACE_ID`. */
  readonly workspaceId: string;
}

/** Rows pushed into a Power BI streaming/push dataset. */
export interface PowerBiDatasetRows {
  /** The target dataset id. */
  readonly datasetId: string;
  /** The table within the dataset. */
  readonly tableName: string;
  /** The rows to append. */
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/** A short-lived token that lets a client embed a Power BI report. */
export interface PowerBiEmbedToken {
  /** The embed token value. */
  readonly token: string;
  /** The URL the report is embedded from. */
  readonly embedUrl: string;
  /** Token expiry timestamp (ISO-8601). */
  readonly expiresAt: string;
}

/**
 * Power BI reporting integration (Requirement 19.2).
 *
 * Extends {@link ReportingPlugin} for the common export surface and adds Power
 * BI's push-dataset ingestion and embed-token issuance so dashboards can be
 * embedded in the platform UI. Request/response only — not webhook-driven.
 */
export interface PowerBiIntegration extends ReportingPlugin {
  /** The Power BI workspace this integration targets. */
  readonly workspaceId: string;
  /** Appends rows to a push dataset for live dashboards. */
  pushRows(rows: PowerBiDatasetRows): Promise<void>;
  /** Issues a short-lived embed token for a report. */
  generateEmbedToken(reportId: string): Promise<PowerBiEmbedToken>;
}
