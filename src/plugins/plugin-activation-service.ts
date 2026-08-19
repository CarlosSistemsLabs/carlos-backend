import type { IPlugin, PluginLogger, PluginMetadata } from './plugin.js';

/**
 * Per-tenant plugin activation via feature flags (task 35.2, Requirement 19.6).
 *
 * Whereas the {@link import('./plugin-loader.js').PluginLoader} brings plugins
 * up platform-wide at boot (discover → initialize → activate), THIS service
 * decides whether an already-loaded plugin is active FOR A GIVEN TENANT, and
 * toggles it on/off, based on the tenant's feature flags (Requirement 19.6:
 * "activation/deactivation per tenant via Feature_Flag").
 *
 * ## Reuse of the existing feature-access mechanism (no duplication)
 *
 * The decision is delegated ENTIRELY to the platform's existing feature-access
 * resolution — the same mechanism behind the `app.requireFeature` guard and the
 * Subscriptions module's feature-access service, which already combines the
 * tenant's subscription plan with its per-tenant feature-flag overrides
 * (Requirements 10, 12). This service depends only on the small structural
 * {@link PluginFeatureAccess} port below; the Subscriptions
 * `IFeatureAccessService` (bound to `SUBSCRIPTION_TOKENS.FeatureAccessService`)
 * satisfies it directly, so the SAME instance is injected at the composition
 * root and NO feature-flag logic is re-implemented here. Declaring a local
 * structural port (rather than importing the module type) keeps the Plugin
 * System decoupled from the Subscriptions module, mirroring how the plugin
 * contracts declare a local {@link PluginLogger} instead of depending on pino.
 *
 * ## Feature-flag key convention
 *
 * A plugin's flag key defaults to `plugin:{id}` (e.g. `plugin:mercadopago`) so
 * plugin flags share a stable, collision-free namespace in the feature-flag
 * store. The convention is injectable via {@link PluginActivationOptions.featureKey}
 * for deployments that map plugins onto existing feature names.
 *
 * ## Graceful degradation
 *
 * Toggling a plugin's lifecycle (`activate`/`deactivate`) is fault-isolated: a
 * plugin that throws while (de)activating is logged and reported as "not
 * (de)activated" rather than propagating — a misbehaving integration must never
 * break tenant request handling (Requirement 19.5). The read-only
 * {@link PluginActivationService.isActiveForTenant} predicate does propagate
 * feature-access errors, since an inability to resolve access is a caller
 * concern to handle, not a plugin fault to swallow.
 */

/**
 * The structural subset of the feature-access mechanism this service needs.
 *
 * Declared locally so the Plugin System takes NO dependency on the Subscriptions
 * module; the Subscriptions `IFeatureAccessService` (its `isFeatureEnabled`
 * method) satisfies this port verbatim and is injected unchanged at the
 * composition root — the single source of truth for plan + feature-flag
 * resolution (Requirements 10, 12).
 */
export interface PluginFeatureAccess {
  /**
   * @param tenantId - The tenant to resolve access for.
   * @param feature - The feature-flag key.
   * @returns `true` only when the feature is enabled for the tenant.
   */
  isFeatureEnabled(tenantId: string, feature: string): Promise<boolean>;
}

/** Derives the feature-flag key for a plugin. */
export type PluginFeatureKey = (metadata: PluginMetadata) => string;

/** The default flag-key convention: `plugin:{id}`. */
export const defaultPluginFeatureKey: PluginFeatureKey = (metadata) => `plugin:${metadata.id}`;

/** Options for constructing a {@link PluginActivationService}. */
export interface PluginActivationOptions {
  /**
   * The feature-access mechanism used to decide per-tenant activation. Bind the
   * Subscriptions `IFeatureAccessService` here.
   */
  readonly featureAccess: PluginFeatureAccess;
  /** Logger for activation observability + graceful-degradation reporting. */
  readonly logger: PluginLogger;
  /** Flag-key convention. Defaults to {@link defaultPluginFeatureKey}. */
  readonly featureKey?: PluginFeatureKey;
}

/**
 * Decides and toggles per-tenant plugin activation via feature flags.
 *
 * @see PluginActivationOptions for wiring.
 */
export class PluginActivationService {
  private readonly featureAccess: PluginFeatureAccess;
  private readonly logger: PluginLogger;
  private readonly featureKey: PluginFeatureKey;

  constructor(options: PluginActivationOptions) {
    this.featureAccess = options.featureAccess;
    this.logger = options.logger;
    this.featureKey = options.featureKey ?? defaultPluginFeatureKey;
  }

  /**
   * The feature-flag key this service consults for a plugin.
   *
   * @param plugin - The plugin whose flag key is requested.
   */
  featureKeyFor(plugin: IPlugin): string {
    return this.featureKey(plugin.metadata);
  }

  /**
   * Resolves whether a plugin is active for a tenant, purely by consulting the
   * tenant's feature flags (Requirement 19.6). Read-only: it does NOT toggle
   * the plugin lifecycle.
   *
   * @param plugin - The plugin to check.
   * @param tenantId - The tenant to resolve activation for.
   * @returns `true` when the plugin's feature flag is enabled for the tenant.
   */
  async isActiveForTenant(plugin: IPlugin, tenantId: string): Promise<boolean> {
    return this.featureAccess.isFeatureEnabled(tenantId, this.featureKeyFor(plugin));
  }

  /**
   * Activates a plugin for a tenant IFF its feature flag is enabled
   * (Requirement 19.6). When the flag is enabled the plugin's `activate()` is
   * driven; when disabled the call is a no-op returning `false`.
   *
   * Fault-isolated: a plugin that throws while activating is logged and reported
   * as not-activated (`false`) rather than propagating (Requirement 19.5).
   *
   * @param plugin - The plugin to activate.
   * @param tenantId - The tenant the activation is scoped to.
   * @returns `true` when the plugin is active for the tenant afterwards.
   */
  async activateForTenant(plugin: IPlugin, tenantId: string): Promise<boolean> {
    const enabled = await this.isActiveForTenant(plugin, tenantId);
    if (!enabled) {
      this.logger.info(
        { plugin_id: plugin.metadata.id, tenant_id: tenantId },
        'Plugin not activated for tenant: feature flag disabled',
      );
      return false;
    }

    try {
      await plugin.activate();
      this.logger.info(
        { plugin_id: plugin.metadata.id, tenant_id: tenantId },
        'Plugin activated for tenant',
      );
      return true;
    } catch (cause) {
      this.reportToggleFailure('activate', plugin, tenantId, cause);
      return false;
    }
  }

  /**
   * Deactivates a plugin for a tenant, driving its `deactivate()` (reversible
   * via {@link activateForTenant}). Used when a tenant disables the integration
   * via its feature flag (Requirement 19.6).
   *
   * Fault-isolated: a plugin that throws while deactivating is logged and
   * reported as not-deactivated (`false`) rather than propagating
   * (Requirement 19.5).
   *
   * @param plugin - The plugin to deactivate.
   * @param tenantId - The tenant the deactivation is scoped to.
   * @returns `true` when the plugin deactivated cleanly.
   */
  async deactivateForTenant(plugin: IPlugin, tenantId: string): Promise<boolean> {
    try {
      await plugin.deactivate();
      this.logger.info(
        { plugin_id: plugin.metadata.id, tenant_id: tenantId },
        'Plugin deactivated for tenant',
      );
      return true;
    } catch (cause) {
      this.reportToggleFailure('deactivate', plugin, tenantId, cause);
      return false;
    }
  }

  /** Logs a lifecycle-toggle fault without propagating it (Requirement 19.5). */
  private reportToggleFailure(
    action: 'activate' | 'deactivate',
    plugin: IPlugin,
    tenantId: string,
    cause: unknown,
  ): void {
    this.logger.error(
      {
        plugin_id: plugin.metadata.id,
        tenant_id: tenantId,
        action,
        error_name: cause instanceof Error ? cause.name : typeof cause,
        error_message: cause instanceof Error ? cause.message : String(cause),
      },
      `Plugin failed to ${action} for tenant; continuing`,
    );
  }
}
