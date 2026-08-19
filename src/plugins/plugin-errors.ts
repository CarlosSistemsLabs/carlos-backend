import { DomainError, ErrorCode } from '@domain/errors/index.js';

/**
 * Base class for Plugin System errors (task 35.1, Requirement 19.1).
 *
 * Extends {@link DomainError} so plugin failures carry a stable
 * {@link ErrorCode} + suggested HTTP status and are translated to transport
 * responses by the same outer-layer machinery as every other domain error —
 * the Plugin System never leaks framework concerns into the core.
 */
export abstract class PluginError extends DomainError {}

/**
 * Raised when registering a plugin whose id is already present in the
 * {@link PluginRegistry}. Plugin ids are the registry key and must be unique;
 * a duplicate almost always indicates a wiring mistake, so it is surfaced
 * rather than silently overwriting the existing registration.
 */
export class DuplicatePluginError extends PluginError {
  public readonly code = ErrorCode.CONFLICT;
  public readonly httpStatus = 409;

  /** @param pluginId - The id that was already registered. */
  constructor(pluginId: string) {
    super(`A plugin with id "${pluginId}" is already registered`, { pluginId });
  }
}

/**
 * The lifecycle phase a plugin was in when it failed during loading, recorded
 * on {@link PluginLoadError} so operators can tell a discovery/registration
 * fault (bad factory, duplicate id) apart from a runtime initialize/activate
 * fault (bad credentials, unreachable vendor) — Requirement 19.5.
 */
export const PluginLoadPhase = {
  /** Producing the instance from its factory + registering it in the catalogue. */
  Discovery: 'discovery',
  /** One-time `initialize(context)` (reading config, building clients). */
  Initialize: 'initialize',
  /** Transitioning the plugin to the active state via `activate()`. */
  Activate: 'activate',
} as const;

/** Union of all valid {@link PluginLoadPhase} values. */
export type PluginLoadPhase = (typeof PluginLoadPhase)[keyof typeof PluginLoadPhase];

/**
 * Raised (and CAUGHT) when a plugin throws while being loaded — during
 * discovery/registration, `initialize` or `activate` (Requirement 19.5).
 *
 * The loader's contract is that ONE bad plugin must never crash boot or take
 * down the host, so this error is never allowed to propagate out of the loader:
 * it is the typed record the loader stores in its failed-plugin state (and logs
 * through the crash-reporter seam) so a failure is observable while the
 * remaining plugins continue to load. Wrapping the underlying throwable in a
 * {@link PluginError} keeps plugin faults inside the same domain-error hierarchy
 * as the rest of the system and preserves the original via {@link Error.cause}.
 */
export class PluginLoadError extends PluginError {
  public readonly code = ErrorCode.INTERNAL;
  public readonly httpStatus = 500;

  /** The lifecycle phase the plugin was in when it failed. */
  public readonly phase: PluginLoadPhase;

  /**
   * @param pluginId - The id of the plugin that failed (or the best-known
   *   identifier when discovery failed before metadata was available).
   * @param phase - The {@link PluginLoadPhase} the plugin was in when it failed.
   * @param cause - The original error thrown by the plugin/factory.
   */
  constructor(pluginId: string, phase: PluginLoadPhase, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Plugin "${pluginId}" failed during ${phase}: ${reason}`, { pluginId, phase });
    this.phase = phase;
    // Preserve the original throwable for diagnostics without losing the typed
    // domain error the rest of the system handles.
    this.cause = cause;
  }
}
