import type { IPlugin, PluginType } from './plugin.js';
import { DuplicatePluginError } from './plugin-errors.js';

/**
 * In-memory registry of installed plugins (task 35.1, Requirements 19.1, 19.4).
 *
 * The registry is the single catalogue of the plugins known to the platform.
 * It is intentionally a PURE catalogue: it stores plugins keyed by their unique
 * id, indexes them by {@link PluginType}, and guards against duplicate
 * registration — nothing more. It performs NO discovery, NO lifecycle
 * transitions and NO per-tenant activation; those are layered on top by task
 * 35.2, which drives the {@link IPlugin} lifecycle and consults this registry
 * to find the plugins to activate.
 *
 * Keeping the registry free of loading/activation logic preserves a clean seam:
 * task 35.2 can wrap or compose it (e.g. a loader that discovers adapters and
 * calls `register`, plus a per-tenant activation table) without changing this
 * class, and the domain never depends on any concrete plugin (Requirement 19.1).
 */
export class PluginRegistry {
  /** Plugins keyed by their unique {@link IPlugin.metadata} id. */
  private readonly plugins = new Map<string, IPlugin>();

  /**
   * Registers a plugin under its metadata id.
   *
   * @param plugin - The plugin to add to the catalogue.
   * @throws {DuplicatePluginError} when a plugin with the same id is already
   *   registered — ids are the registry key and must be unique.
   */
  register(plugin: IPlugin): void {
    const { id } = plugin.metadata;
    if (this.plugins.has(id)) {
      throw new DuplicatePluginError(id);
    }
    this.plugins.set(id, plugin);
  }

  /**
   * Removes a plugin from the catalogue.
   *
   * @param id - The id of the plugin to remove.
   * @returns `true` when a plugin was removed; `false` when none matched.
   */
  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  /**
   * Resolves a plugin by id.
   *
   * The optional type parameter narrows the return type to a specific
   * {@link IPlugin} sub-interface (e.g. `get<PaymentPlugin>(id)`) as a
   * convenience for callers that already know the plugin's category; it is a
   * compile-time cast only and does not perform a runtime type check.
   *
   * @param id - The id of the plugin to resolve.
   * @returns The plugin, or `undefined` when no plugin with that id exists.
   */
  get<T extends IPlugin = IPlugin>(id: string): T | undefined {
    return this.plugins.get(id) as T | undefined;
  }

  /**
   * @param id - The id to check.
   * @returns `true` when a plugin with the given id is registered.
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * Lists every registered plugin.
   *
   * @returns A defensive snapshot array; mutating it does not affect the
   *   registry.
   */
  list(): IPlugin[] {
    return [...this.plugins.values()];
  }

  /**
   * Lists the registered plugins of a given category (Requirement 19.4).
   *
   * @param type - The {@link PluginType} to filter by.
   * @returns A defensive snapshot array of the matching plugins.
   */
  listByType(type: PluginType): IPlugin[] {
    return this.list().filter((plugin) => plugin.metadata.type === type);
  }

  /** The number of registered plugins. */
  get size(): number {
    return this.plugins.size;
  }

  /** Removes every registration, resetting the catalogue to empty. */
  clear(): void {
    this.plugins.clear();
  }
}
