import type { IFirebaseAdmin } from '@infrastructure/firebase/index.js';

/**
 * Backend Remote Config service (task 33.5, Requirement 14.7).
 *
 * ## What Remote Config means on the BACKEND
 * Firebase Remote Config is most familiar as a CLIENT SDK (Web/Android/iOS fetch
 * a template and read feature flags / dynamic config on the device). On the
 * BACKEND, the Firebase Admin SDK exposes a *server-side* Remote Config surface
 * (`admin.remoteConfig().getServerTemplate()` → `template.evaluate()` →
 * `ServerConfig`) intended for exactly this: driving **feature flags** and
 * **dynamic configuration** from a central, environment-scoped template
 * (Requirement 14.4/14.7) without a redeploy — "WHEN Remote Config is updated,
 * THE Carlos_Platform SHALL apply changes within 5 minutes".
 *
 * ## Environment separation (Requirement 14.7)
 * The template is fetched through the {@link IFirebaseAdmin} client, whose
 * project id + credentials come entirely from env. A TEST deployment and a
 * PRODUCTION deployment therefore read their OWN, separate Remote Config
 * settings automatically — no branching on `NODE_ENV` is required here.
 *
 * ## Graceful degradation (never throws)
 * There is no Firebase project / credentials in this environment and the
 * `firebase-admin` package is deliberately not installed, so {@link IFirebaseAdmin}
 * reports `isEnabled === false`. Mirroring the analytics (task 33.2) and crash
 * reporting (task 33.3) seams, this service NEVER throws and NEVER breaks a
 * business operation: every accessor takes a caller-supplied local default and
 * returns it whenever Firebase is disabled, the template cannot be fetched, the
 * key is missing, or the SDK surface is not the shape we expect. A local default
 * is the safe fallback for a feature flag.
 *
 * The port below is the seam: a live Firebase-backed implementation
 * ({@link FirebaseRemoteConfigService}) binds today; nothing at a call site
 * changes when real credentials are provisioned.
 */

/**
 * Backend Remote Config port. Consumers depend only on this abstraction; the
 * concrete source (Firebase server template today, or a static/local provider
 * in tests) is bound in the composition root.
 *
 * Every accessor is asynchronous (fetching/evaluating the server template is an
 * async operation) and takes an explicit local default. Implementations MUST
 * NOT throw: on any error, when Firebase is disabled, or when a key is absent,
 * the provided default is returned. This makes the service safe to call from
 * any layer, including inside request handling and background jobs.
 */
export interface IRemoteConfigService {
  /**
   * Resolves a boolean parameter — the primary shape of a FEATURE FLAG
   * (Requirement 14.4). Returns `defaultValue` when disabled, unreachable, or
   * the key is missing/unparseable.
   *
   * @param key - The Remote Config parameter key.
   * @param defaultValue - Safe local fallback (the value to use when the remote
   *   template cannot be consulted).
   */
  getBoolean(key: string, defaultValue: boolean): Promise<boolean>;

  /**
   * Resolves a string parameter (dynamic configuration — Requirement 14.4).
   * Returns `defaultValue` when disabled, unreachable, or the key is missing.
   */
  getString(key: string, defaultValue: string): Promise<string>;

  /**
   * Resolves a numeric parameter (dynamic configuration — Requirement 14.4).
   * Returns `defaultValue` when disabled, unreachable, or the key is
   * missing/unparseable.
   */
  getNumber(key: string, defaultValue: number): Promise<number>;

  /**
   * Convenience feature-flag accessor reading naturally at call sites
   * (`if (await remoteConfig.isFeatureEnabled('new_checkout')) { ... }`).
   * Delegates to {@link getBoolean}; the default is `false` (a flag defaults to
   * OFF) unless overridden.
   */
  isFeatureEnabled(key: string, defaultValue?: boolean): Promise<boolean>;

  /**
   * Returns every parameter's evaluated value as strings. Useful for exposing
   * the active configuration (e.g. bootstrapping a client or diagnostics).
   * Returns an empty object when disabled or unreachable (never throws).
   */
  getAll(): Promise<Record<string, string>>;
}

/**
 * Minimal structural logger the Remote Config service depends on — a subset of
 * pino / the application's structured logger. Declared locally so this module
 * takes no hard dependency on any concrete logger, mirroring the analytics and
 * crash-reporting seams. Used only to `warn` when a remote fetch fails and the
 * service falls back to defaults.
 */
export interface RemoteConfigLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * The evaluated server-side Remote Config surface this service consumes — the
 * shape of the Admin SDK's `ServerConfig` (returned by
 * `ServerTemplate.evaluate()`). Modelled structurally because `firebase-admin`
 * is not installed here (its `remoteConfig()` accessor is typed `unknown`); the
 * live SDK object satisfies this at runtime and is narrowed defensively.
 */
interface RemoteConfigServerConfigLike {
  getBoolean(key: string): boolean;
  getString(key: string): string;
  getNumber(key: string): number;
  getAll(): Record<string, unknown>;
}

/** The `ServerTemplate` shape: `evaluate()` yields a {@link RemoteConfigServerConfigLike}. */
interface RemoteConfigServerTemplateLike {
  evaluate(): RemoteConfigServerConfigLike;
}

/** The `admin.remoteConfig()` shape we use: fetches the server template. */
interface RemoteConfigSdkLike {
  getServerTemplate(): Promise<RemoteConfigServerTemplateLike>;
}

/** Narrow: does the value expose a callable `getServerTemplate`? */
function isRemoteConfigSdk(value: unknown): value is RemoteConfigSdkLike {
  return typeof value === 'object' && value !== null && hasFn(value, 'getServerTemplate');
}

/** Narrow: does the value expose a callable `evaluate`? */
function isServerTemplate(value: unknown): value is RemoteConfigServerTemplateLike {
  return typeof value === 'object' && value !== null && hasFn(value, 'evaluate');
}

/** Narrow: does the value expose the {@link RemoteConfigServerConfigLike} accessors? */
function isServerConfig(value: unknown): value is RemoteConfigServerConfigLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasFn(value, 'getBoolean') &&
    hasFn(value, 'getString') &&
    hasFn(value, 'getNumber') &&
    hasFn(value, 'getAll')
  );
}

/** True when `obj[name]` is a function. */
function hasFn(obj: object, name: string): boolean {
  return typeof (obj as Record<string, unknown>)[name] === 'function';
}

/**
 * Coerces an evaluated Remote Config parameter value to a string for
 * {@link IRemoteConfigService.getAll}. The Admin SDK yields a `Value` object
 * (with an `asString()` method); a plain string/number/boolean is handled too
 * so a static/fake provider works without wrapping.
 */
function coerceToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null && hasFn(value, 'asString')) {
    const asString = (value as { asString(): unknown }).asString();
    return typeof asString === 'string' ? asString : String(asString);
  }
  return String(value);
}

/**
 * Firebase-backed {@link IRemoteConfigService}. Reads the server-side Remote
 * Config template via {@link IFirebaseAdmin} and evaluates it to a
 * {@link RemoteConfigServerConfigLike}, from which parameter values are read.
 *
 * Behaviour:
 * - When `firebaseAdmin.isEnabled === false` it behaves exactly like
 *   {@link StaticRemoteConfigService}: every accessor returns the caller's
 *   default (and {@link getAll} returns `{}`) without touching the SDK.
 * - When enabled it lazily fetches + evaluates the server template once and
 *   caches the evaluated config (templates change rarely; a real deployment can
 *   add a TTL/refresh later). Any failure — a throwing/absent SDK surface, a
 *   rejected fetch, a missing/unparseable key — is caught and the default is
 *   returned. A single `warn` line is emitted on a fetch failure.
 *
 * The SDK object is typed `unknown` (package not installed), so it is narrowed
 * defensively via the type guards above before use.
 */
export class FirebaseRemoteConfigService implements IRemoteConfigService {
  /** Cached evaluated server config; set on the first successful fetch. */
  private cachedConfig: RemoteConfigServerConfigLike | undefined;
  /** In-flight fetch, so concurrent accessors share a single template fetch. */
  private inflight: Promise<RemoteConfigServerConfigLike | undefined> | undefined;

  constructor(
    private readonly firebaseAdmin: IFirebaseAdmin,
    private readonly logger?: RemoteConfigLogger,
  ) {}

  async getBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const config = await this.resolveConfig();
    if (config === undefined) {
      return defaultValue;
    }
    try {
      return config.getBoolean(key);
    } catch {
      return defaultValue;
    }
  }

  async getString(key: string, defaultValue: string): Promise<string> {
    const config = await this.resolveConfig();
    if (config === undefined) {
      return defaultValue;
    }
    try {
      return config.getString(key);
    } catch {
      return defaultValue;
    }
  }

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const config = await this.resolveConfig();
    if (config === undefined) {
      return defaultValue;
    }
    try {
      const value = config.getNumber(key);
      return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  async isFeatureEnabled(key: string, defaultValue = false): Promise<boolean> {
    return this.getBoolean(key, defaultValue);
  }

  async getAll(): Promise<Record<string, string>> {
    const config = await this.resolveConfig();
    if (config === undefined) {
      return {};
    }
    try {
      const all = config.getAll();
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(all)) {
        result[key] = coerceToString(value);
      }
      return result;
    } catch {
      return {};
    }
  }

  /**
   * Resolves the evaluated server config, returning `undefined` (→ callers fall
   * back to defaults) when Firebase is disabled or the template cannot be
   * fetched/evaluated. Caches the first success; dedupes concurrent fetches; and
   * clears the in-flight handle on failure so a later call can retry.
   */
  private async resolveConfig(): Promise<RemoteConfigServerConfigLike | undefined> {
    if (this.cachedConfig !== undefined) {
      return this.cachedConfig;
    }
    if (!this.firebaseAdmin.isEnabled) {
      return undefined;
    }
    this.inflight ??= this.fetchServerConfig();
    const config = await this.inflight;
    if (config !== undefined) {
      this.cachedConfig = config;
    } else {
      // Allow a future call to retry after a transient failure.
      this.inflight = undefined;
    }
    return config;
  }

  /** Fetches + evaluates the server template, narrowing the SDK defensively. */
  private async fetchServerConfig(): Promise<RemoteConfigServerConfigLike | undefined> {
    try {
      const remoteConfig: unknown = this.firebaseAdmin.remoteConfig();
      if (!isRemoteConfigSdk(remoteConfig)) {
        return undefined;
      }
      const template: unknown = await remoteConfig.getServerTemplate();
      if (!isServerTemplate(template)) {
        return undefined;
      }
      const config: unknown = template.evaluate();
      return isServerConfig(config) ? config : undefined;
    } catch (error) {
      this.logger?.warn(
        {
          remoteConfig: 'fetch_failed',
          error: error instanceof Error ? error.message : String(error),
        },
        'Remote Config fetch failed; falling back to defaults',
      );
      return undefined;
    }
  }
}

/**
 * Static {@link IRemoteConfigService} that always returns the caller-supplied
 * default (never consulting any remote source). Used when Firebase is disabled
 * and as a deterministic test double. An optional static map of values backs
 * {@link getAll} (and lets it double as a simple local/env-driven config
 * provider); the per-key accessors intentionally always return the caller's
 * default so behaviour is trivially predictable.
 */
export class StaticRemoteConfigService implements IRemoteConfigService {
  constructor(private readonly staticValues: Readonly<Record<string, string>> = {}) {}

  async getBoolean(_key: string, defaultValue: boolean): Promise<boolean> {
    return defaultValue;
  }

  async getString(_key: string, defaultValue: string): Promise<string> {
    return defaultValue;
  }

  async getNumber(_key: string, defaultValue: number): Promise<number> {
    return defaultValue;
  }

  async isFeatureEnabled(_key: string, defaultValue = false): Promise<boolean> {
    return defaultValue;
  }

  async getAll(): Promise<Record<string, string>> {
    return { ...this.staticValues };
  }
}
