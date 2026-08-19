import { readFileSync } from 'node:fs';
import { ValidationError } from '@domain/errors/index.js';
import type { Environment } from '@config/environment';

/**
 * Firebase Admin SDK integration (task 33.1, Requirements 13.5 & 14.2).
 *
 * This module owns the backend's single entry point to the Firebase Admin SDK.
 * It reads environment-specific service-account credentials and either
 * initializes a singleton admin app (when credentials are present) or returns a
 * clearly-flagged NO-OP client (when they are absent) so the application boots
 * and the test suite runs without a real Firebase project — the state of the
 * current development environment.
 *
 * **Deferred dependency.** The `firebase-admin` npm package is intentionally NOT
 * a hard dependency here: this environment sits behind an SSL-inspecting proxy
 * that blocks its installation. The real SDK is therefore loaded lazily via a
 * dynamic import ({@link defaultSdkLoader}) that only runs on the ENABLED path,
 * and the SDK surface we consume is abstracted behind {@link FirebaseAdminSdk}
 * so it can be injected in tests. Install `firebase-admin` in CI / real
 * deployments (`npm i firebase-admin`) to activate the enabled path.
 *
 * **Environment separation (Requirement 14.2).** The project id and credentials
 * come entirely from env, so a TEST deployment and a PRODUCTION deployment point
 * at completely separate Firebase projects automatically via their own env vars
 * — no code branching on `NODE_ENV` is required.
 *
 * Downstream tasks build on {@link IFirebaseAdmin}: the Analytics service
 * (task 33.2) and Remote Config service (task 33.5) resolve this port and use
 * its service accessors, checking {@link IFirebaseAdmin.isEnabled} to no-op
 * gracefully when Firebase is disabled.
 */

/**
 * Opaque handle to the initialized firebase-admin `App`. Typed as `unknown`
 * because the package is not installed in this environment; it is threaded back
 * into the SDK's service factories unchanged.
 */
export type FirebaseApp = unknown;

/**
 * Opaque handles to firebase-admin service instances. Typed as `unknown`
 * because the package is not installed here; downstream service wrappers
 * (tasks 33.2 / 33.5) narrow these to the concrete SDK types once the
 * dependency is available in their environment.
 */
export type FirebaseAuthService = unknown;
export type FirebaseMessagingService = unknown;
export type FirebaseRemoteConfigService = unknown;

/**
 * Minimal structural logger the Firebase integration depends on — a subset of
 * pino / the application's structured logger. Kept local so this infrastructure
 * module does not couple to any feature module's logger type.
 */
export interface FirebaseLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * The subset of the `firebase-admin` module surface this integration consumes.
 * Modelling it as an interface lets tests inject a fake and lets the enabled
 * path stay decoupled from the real package (which is dynamically imported).
 */
export interface FirebaseAdminSdk {
  /** Initializes and returns the default admin app for the given credentials. */
  initializeApp(options: { credential: unknown; projectId?: string }, name?: string): FirebaseApp;
  /** Credential factories; only `cert` (service-account) is used here. */
  credential: {
    cert(serviceAccount: {
      projectId: string;
      clientEmail: string;
      privateKey: string;
    }): unknown;
  };
  /** Auth service factory (bound to the initialized app). */
  auth(app?: FirebaseApp): FirebaseAuthService;
  /** Cloud Messaging service factory (bound to the initialized app). */
  messaging(app?: FirebaseApp): FirebaseMessagingService;
  /** Remote Config service factory (bound to the initialized app). */
  remoteConfig(app?: FirebaseApp): FirebaseRemoteConfigService;
  /** Already-initialized apps; used to guard against double initialization. */
  apps?: FirebaseApp[];
}

/** Loads the {@link FirebaseAdminSdk}. Injected in tests; real SDK by default. */
export type FirebaseAdminSdkLoader = () => Promise<FirebaseAdminSdk>;

/**
 * Backend port over the Firebase Admin SDK. Consumers depend only on this
 * abstraction (Clean Architecture). Service accessors throw when Firebase is
 * disabled, so callers MUST check {@link isEnabled} first (or rely on a
 * higher-level wrapper that does).
 */
export interface IFirebaseAdmin {
  /** `true` when initialized with real credentials; `false` for the no-op client. */
  readonly isEnabled: boolean;
  /** The active Firebase project id, or `undefined` when disabled. */
  readonly projectId: string | undefined;
  /** Firebase Authentication admin service. @throws when disabled. */
  auth(): FirebaseAuthService;
  /** Firebase Cloud Messaging admin service. @throws when disabled. */
  messaging(): FirebaseMessagingService;
  /** Firebase Remote Config admin service. @throws when disabled. */
  remoteConfig(): FirebaseRemoteConfigService;
}

/** Normalized service-account credentials extracted from the env/JSON. */
export interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** Raised when a disabled Firebase client's service accessor is used. */
export class FirebaseDisabledError extends Error {
  constructor(service: string) {
    super(
      `Firebase is disabled: cannot access "${service}". No service-account ` +
        `credentials are configured (set FIREBASE_SERVICE_ACCOUNT or ` +
        `FIREBASE_SERVICE_ACCOUNT_PATH). Check isEnabled before calling.`,
    );
    this.name = 'FirebaseDisabledError';
  }
}

/**
 * No-op {@link IFirebaseAdmin} used when no credentials are configured
 * (development / test / any deployment that has not provisioned a project).
 * Reports `isEnabled === false` and throws a descriptive
 * {@link FirebaseDisabledError} if a service is accessed anyway.
 */
export class DisabledFirebaseAdmin implements IFirebaseAdmin {
  public readonly isEnabled = false;
  public readonly projectId: string | undefined = undefined;

  auth(): FirebaseAuthService {
    throw new FirebaseDisabledError('auth');
  }

  messaging(): FirebaseMessagingService {
    throw new FirebaseDisabledError('messaging');
  }

  remoteConfig(): FirebaseRemoteConfigService {
    throw new FirebaseDisabledError('remoteConfig');
  }
}

/**
 * Enabled {@link IFirebaseAdmin} backed by a live firebase-admin app. Service
 * accessors delegate to the SDK's factories bound to the initialized app.
 */
export class EnabledFirebaseAdmin implements IFirebaseAdmin {
  public readonly isEnabled = true;

  constructor(
    private readonly sdk: FirebaseAdminSdk,
    private readonly app: FirebaseApp,
    public readonly projectId: string | undefined,
  ) {}

  auth(): FirebaseAuthService {
    return this.sdk.auth(this.app);
  }

  messaging(): FirebaseMessagingService {
    return this.sdk.messaging(this.app);
  }

  remoteConfig(): FirebaseRemoteConfigService {
    return this.sdk.remoteConfig(this.app);
  }
}

/** Dependencies for {@link buildFirebaseAdmin}; all optional (test seams). */
export interface FirebaseAdminDeps {
  /** Loads the firebase-admin SDK (defaults to a dynamic import of the package). */
  sdkLoader?: FirebaseAdminSdkLoader;
  /** Structured logger for the enabled/disabled boot line. */
  logger?: FirebaseLogger;
  /** Reads a service-account file (defaults to `fs.readFileSync`); injected in tests. */
  readFile?: (path: string) => string;
}

/**
 * Builds the Firebase Admin client for the running environment.
 *
 * - No credentials → resolves a {@link DisabledFirebaseAdmin} and logs a single
 *   info line (never throws), so the app boots without a Firebase project.
 * - Credentials present → validates the service account (throwing a
 *   {@link ValidationError} on invalid JSON or missing fields), then loads the
 *   SDK and initializes a singleton app (reusing an already-initialized app to
 *   guard against re-init), returning an {@link EnabledFirebaseAdmin}.
 *
 * @param environment - Environment configuration (defaults must be provided by caller).
 * @param deps - Optional test seams (SDK loader, logger, file reader).
 */
export async function buildFirebaseAdmin(
  environment: Environment,
  deps: FirebaseAdminDeps = {},
): Promise<IFirebaseAdmin> {
  const logger = deps.logger ?? defaultFirebaseLogger;
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  const serviceAccount = resolveServiceAccount(environment, readFile);
  if (serviceAccount === undefined) {
    logger.info(
      { firebase: 'disabled' },
      'Firebase Admin disabled: no service-account credentials configured',
    );
    return new DisabledFirebaseAdmin();
  }

  const projectId = environment.FIREBASE_PROJECT_ID ?? serviceAccount.projectId;

  const sdk = await (deps.sdkLoader ?? defaultSdkLoader)();

  // Guard against re-initialization: reuse an existing default app if the SDK
  // already has one (firebase-admin throws on a duplicate default app).
  const existingApps = sdk.apps ?? [];
  const app =
    existingApps.length > 0
      ? existingApps[0]
      : sdk.initializeApp({
          credential: sdk.credential.cert({
            projectId: serviceAccount.projectId,
            clientEmail: serviceAccount.clientEmail,
            privateKey: serviceAccount.privateKey,
          }),
          projectId,
        });

  logger.info({ firebase: 'enabled', projectId }, 'Firebase Admin initialized');
  return new EnabledFirebaseAdmin(sdk, app, projectId);
}

/**
 * Default SDK loader: a dynamic import of `firebase-admin`. The specifier is
 * held in a variable so the TypeScript compiler does not attempt to resolve the
 * (deliberately uninstalled) module at build time; it resolves at runtime only
 * on the enabled path, when the package is present.
 */
const defaultSdkLoader: FirebaseAdminSdkLoader = async () => {
  const moduleName = 'firebase-admin';
  const imported = (await import(moduleName)) as { default?: FirebaseAdminSdk } & FirebaseAdminSdk;
  return imported.default ?? imported;
};

/** Fallback logger used before the application's pino logger is injected. */
const defaultFirebaseLogger: FirebaseLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- boot-time fallback before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
};

/**
 * Resolves the service account from env, or `undefined` when neither the JSON
 * string nor the file path is configured. `FIREBASE_SERVICE_ACCOUNT` (raw JSON)
 * takes precedence over `FIREBASE_SERVICE_ACCOUNT_PATH` (file).
 */
function resolveServiceAccount(
  environment: Environment,
  readFile: (path: string) => string,
): FirebaseServiceAccount | undefined {
  const inline = environment.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (inline !== undefined && inline !== '') {
    return parseServiceAccount(inline, 'FIREBASE_SERVICE_ACCOUNT');
  }

  const path = environment.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path !== undefined && path !== '') {
    let raw: string;
    try {
      raw = readFile(path);
    } catch (error) {
      throw new ValidationError(
        `Failed to read Firebase service account file at "${path}"`,
        { field: 'FIREBASE_SERVICE_ACCOUNT_PATH', cause: errorMessage(error) },
      );
    }
    return parseServiceAccount(raw, 'FIREBASE_SERVICE_ACCOUNT_PATH');
  }

  return undefined;
}

/**
 * Parses and validates raw service-account JSON, accepting both the snake_case
 * shape Google emits (`project_id`, `client_email`, `private_key`) and its
 * camelCase equivalents. Escaped `\n` sequences in the private key are expanded
 * (common when the JSON is flattened into a single-line env var).
 *
 * @throws {ValidationError} on invalid JSON or missing/blank required fields.
 */
function parseServiceAccount(raw: string, source: string): FirebaseServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ValidationError(`Invalid ${source}: expected a valid JSON service account`, {
      field: source,
      cause: errorMessage(error),
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(`Invalid ${source}: expected a JSON object`, { field: source });
  }

  const obj = parsed as Record<string, unknown>;
  const projectId = pickString(obj, 'project_id', 'projectId');
  const clientEmail = pickString(obj, 'client_email', 'clientEmail');
  const privateKey = pickString(obj, 'private_key', 'privateKey');

  const missing: string[] = [];
  if (projectId === undefined) missing.push('project_id');
  if (clientEmail === undefined) missing.push('client_email');
  if (privateKey === undefined) missing.push('private_key');
  if (missing.length > 0) {
    throw new ValidationError(
      `Invalid ${source}: missing required field(s): ${missing.join(', ')}`,
      { field: source, missing },
    );
  }

  return {
    projectId: projectId as string,
    clientEmail: clientEmail as string,
    privateKey: (privateKey as string).replace(/\\n/g, '\n'),
  };
}

/** Returns the first non-empty string value among the given keys, else undefined. */
function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/** Extracts a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
