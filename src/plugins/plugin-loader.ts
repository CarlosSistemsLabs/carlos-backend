import type { IPlugin, PluginContext, PluginLogger } from './plugin.js';
import type { PluginRegistry } from './plugin-registry.js';
import { PluginLoadError, PluginLoadPhase } from './plugin-errors.js';

/**
 * Plugin loading, discovery and initialization (task 35.2, Requirements 19.3,
 * 19.5).
 *
 * The loader is the layer that sits ON TOP of the {@link PluginRegistry}
 * catalogue (task 35.1): it DISCOVERS the plugins to install, REGISTERS them,
 * and drives each through the first part of the {@link IPlugin} lifecycle —
 * `initialize(context)` then `activate()` — in a single ordered, awaited pass
 * (Requirement 19.3, "load a registered plugin without modifying domain code").
 * Per-TENANT activation via feature flags is a separate concern handled by the
 * {@link import('./plugin-activation-service.js').PluginActivationService}
 * (Requirement 19.6).
 *
 * ## Deterministic, injectable discovery (no filesystem/dynamic import)
 *
 * Discovery is driven by an EXPLICIT, injectable list of {@link PluginFactory}
 * functions rather than by scanning the filesystem or dynamically importing
 * arbitrary paths. That keeps loading deterministic and trivially testable, and
 * keeps the domain free of any concrete adapter (Requirement 19.1) — the
 * factories are supplied by the composition root, which is the only place that
 * knows the concrete plugins (task 35.3 adapters bind here). A real
 * filesystem/npm discovery mechanism (scanning a `plugins/` directory, reading
 * an installed-plugins manifest, or `import()`-ing packages named in config)
 * plugs in behind this SAME seam later: such a mechanism would resolve the set
 * of modules and expose each as a {@link PluginFactory}, with no change to the
 * loader or its call sites.
 *
 * ## Graceful degradation (Requirement 19.5)
 *
 * A single misbehaving plugin MUST NOT crash boot or take down the host. Every
 * per-plugin step (factory invocation + registration, `initialize`, `activate`)
 * is isolated in a try/catch: on failure the loader logs through the injected
 * {@link PluginLogger} (the crash-reporter seam at the composition root), marks
 * that plugin as failed in its observable {@link PluginLoadResult.failed} state,
 * and CONTINUES with the remaining plugins. {@link load} therefore NEVER throws.
 */

/**
 * An explicit, deterministic source of a plugin instance.
 *
 * A factory produces a ready-to-register {@link IPlugin}; it is the unit of
 * discovery. Using a factory (rather than a pre-built instance) lets the loader
 * isolate construction failures per plugin and defers any expensive wiring to
 * load time. A future filesystem/npm discovery mechanism produces these
 * factories from the modules it finds, behind the same seam.
 */
export type PluginFactory = () => IPlugin;

/**
 * Resolves the opaque, per-plugin configuration passed to
 * {@link IPlugin.initialize} via {@link PluginContext.config}.
 *
 * Kept as an injectable port so the loader never hard-codes where configuration
 * comes from: credentials/endpoints/toggles may be sourced from environment,
 * per-tenant secrets, or the Remote Config feature-flag store. The default
 * (see {@link PluginLoader}) resolves an empty record so plugins that need no
 * configuration load without any wiring.
 */
export interface PluginConfigResolver {
  /**
   * @param pluginId - The id of the plugin whose configuration is requested.
   * @returns The plugin's configuration record (may be async).
   */
  resolve(
    pluginId: string,
  ): Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;
}

/** Options for constructing a {@link PluginLoader}. */
export interface PluginLoaderOptions {
  /**
   * The catalogue discovered plugins are registered into. The loader owns the
   * lifecycle; the registry stays a pure catalogue (task 35.1).
   */
  readonly registry: PluginRegistry;
  /**
   * Logger for lifecycle + failure observability. Satisfied by the application
   * pino logger / crash-reporter seam at the composition root.
   */
  readonly logger: PluginLogger;
  /**
   * Resolver for each plugin's initialization config. Defaults to a resolver
   * that returns an empty record.
   */
  readonly configResolver?: PluginConfigResolver;
}

/** A recorded plugin load failure, exposed for observability (Requirement 19.5). */
export interface PluginFailure {
  /** The id of the plugin that failed (best-known identifier for discovery faults). */
  readonly pluginId: string;
  /** The lifecycle phase the plugin was in when it failed. */
  readonly phase: PluginLoadPhase;
  /** The typed error describing the failure (wraps the original via `cause`). */
  readonly error: PluginLoadError;
}

/** Outcome of a {@link PluginLoader.load} pass. */
export interface PluginLoadResult {
  /** Ids of the plugins that initialized and activated successfully. */
  readonly loaded: readonly string[];
  /** The plugins that failed at some phase, with their typed errors. */
  readonly failed: readonly PluginFailure[];
}

/** The default config resolver: no per-plugin configuration. */
const EMPTY_CONFIG_RESOLVER: PluginConfigResolver = {
  resolve: () => ({}),
};

/**
 * Discovers, registers and initializes plugins with graceful degradation.
 *
 * @see PluginLoaderOptions for wiring.
 */
export class PluginLoader {
  private readonly registry: PluginRegistry;
  private readonly logger: PluginLogger;
  private readonly configResolver: PluginConfigResolver;

  /** Failed plugins from the most recent {@link load}, keyed by id, for observability. */
  private readonly failures = new Map<string, PluginFailure>();

  constructor(options: PluginLoaderOptions) {
    this.registry = options.registry;
    this.logger = options.logger;
    this.configResolver = options.configResolver ?? EMPTY_CONFIG_RESOLVER;
  }

  /**
   * Discovers the plugins produced by `factories`, registers each into the
   * {@link PluginRegistry}, then drives it through `initialize(context)` and
   * `activate()` in a single ordered, awaited pass.
   *
   * The pass is fault-isolated per plugin (Requirement 19.5): a factory that
   * throws, a duplicate id, or an `initialize`/`activate` that rejects is
   * caught, logged and recorded in the returned {@link PluginLoadResult.failed}
   * list; the remaining plugins still load. This method NEVER throws.
   *
   * @param factories - The explicit, ordered discovery source (see
   *   {@link PluginFactory}).
   * @returns A report of the plugins that loaded and those that failed.
   */
  async load(factories: readonly PluginFactory[]): Promise<PluginLoadResult> {
    this.failures.clear();
    const loaded: string[] = [];

    for (const factory of factories) {
      const plugin = this.discover(factory);
      if (plugin === undefined) {
        continue;
      }

      const initialized = await this.initializePlugin(plugin);
      if (!initialized) {
        continue;
      }

      const activated = await this.activatePlugin(plugin);
      if (!activated) {
        continue;
      }

      loaded.push(plugin.metadata.id);
      this.logger.info(
        { plugin_id: plugin.metadata.id, plugin_type: plugin.metadata.type },
        'Plugin loaded',
      );
    }

    return { loaded, failed: [...this.failures.values()] };
  }

  /**
   * The plugins that failed during the most recent {@link load}, as a defensive
   * snapshot. Exposed so boot diagnostics / health checks can surface degraded
   * integrations (Requirement 19.5).
   */
  getFailures(): PluginFailure[] {
    return [...this.failures.values()];
  }

  /**
   * @param pluginId - The plugin id to check.
   * @returns `true` when the plugin failed to load in the most recent pass.
   */
  hasFailed(pluginId: string): boolean {
    return this.failures.has(pluginId);
  }

  /**
   * Invokes a factory and registers the produced plugin. Isolates construction
   * and duplicate-id faults as {@link PluginLoadPhase.Discovery} failures.
   */
  private discover(factory: PluginFactory): IPlugin | undefined {
    let plugin: IPlugin;
    try {
      plugin = factory();
    } catch (cause) {
      this.recordFailure('<unknown>', PluginLoadPhase.Discovery, cause);
      return undefined;
    }

    try {
      this.registry.register(plugin);
    } catch (cause) {
      // A duplicate id (or any registry rejection) is a wiring fault: record it
      // and skip, never abort the whole load.
      this.recordFailure(plugin.metadata.id, PluginLoadPhase.Discovery, cause);
      return undefined;
    }

    return plugin;
  }

  /** Drives `initialize(context)`, isolating any fault. */
  private async initializePlugin(plugin: IPlugin): Promise<boolean> {
    try {
      const config = await this.configResolver.resolve(plugin.metadata.id);
      const context: PluginContext = { logger: this.logger, config };
      await plugin.initialize(context);
      return true;
    } catch (cause) {
      this.recordFailure(plugin.metadata.id, PluginLoadPhase.Initialize, cause);
      return false;
    }
  }

  /** Drives `activate()`, isolating any fault. */
  private async activatePlugin(plugin: IPlugin): Promise<boolean> {
    try {
      await plugin.activate();
      return true;
    } catch (cause) {
      this.recordFailure(plugin.metadata.id, PluginLoadPhase.Activate, cause);
      return false;
    }
  }

  /**
   * Wraps a caught throwable in a typed {@link PluginLoadError}, logs it and
   * records it in the observable failed-plugin state. Never re-throws.
   */
  private recordFailure(pluginId: string, phase: PluginLoadPhase, cause: unknown): void {
    const error = new PluginLoadError(pluginId, phase, cause);
    this.failures.set(pluginId, { pluginId, phase, error });
    this.logger.error(
      {
        plugin_id: pluginId,
        phase,
        error_name: cause instanceof Error ? cause.name : typeof cause,
        error_message: cause instanceof Error ? cause.message : String(cause),
      },
      'Plugin failed to load; continuing with remaining plugins',
    );
  }
}
