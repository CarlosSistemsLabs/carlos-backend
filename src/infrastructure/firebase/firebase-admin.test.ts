import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@domain/errors/index.js';
import type { Environment } from '@config/environment';
import {
  buildFirebaseAdmin,
  DisabledFirebaseAdmin,
  EnabledFirebaseAdmin,
  FirebaseDisabledError,
  type FirebaseAdminSdk,
  type FirebaseLogger,
} from './firebase-admin.js';

/**
 * Minimal Environment stub. Only the fields the Firebase integration reads are
 * meaningful; the rest are filled so the object satisfies the type without
 * pulling in the real loader (which requires a DATABASE_URL etc.).
 */
function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    NODE_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: 3000,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    DATABASE_POOL_SIZE: 10,
    DATABASE_POOL_TIMEOUT: 10,
    CORS_ORIGIN: '',
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    CSRF_ENABLED: false,
    HSTS_MAX_AGE: 31_536_000,
    METRICS_ENABLED: true,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    JWT_ISSUER: 'carlos-erp',
    ERROR_ALERT_THRESHOLD: 10,
    ERROR_ALERT_WINDOW_MS: 60_000,
    ERROR_ALERT_COOLDOWN_MS: 300_000,
    SUSPICIOUS_ACTIVITY_THRESHOLD: 5,
    SUSPICIOUS_ACTIVITY_WINDOW_MS: 300_000,
    SUSPICIOUS_ACTIVITY_COOLDOWN_MS: 300_000,
    ...overrides,
  } as Environment;
}

/** A fake firebase-admin SDK that records how it was called. */
function makeFakeSdk(): {
  sdk: FirebaseAdminSdk;
  calls: { cert: unknown[]; initializeApp: unknown[] };
} {
  const calls = { cert: [] as unknown[], initializeApp: [] as unknown[] };
  const sdk: FirebaseAdminSdk = {
    credential: {
      cert(serviceAccount) {
        calls.cert.push(serviceAccount);
        return { __credential: true };
      },
    },
    initializeApp(options) {
      calls.initializeApp.push(options);
      return { __app: true };
    },
    auth(app) {
      return { service: 'auth', app };
    },
    messaging(app) {
      return { service: 'messaging', app };
    },
    remoteConfig(app) {
      return { service: 'remoteConfig', app };
    },
    apps: [],
  };
  return { sdk, calls };
}

function silentLogger(): FirebaseLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

const VALID_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'carlos-erp-test',
  client_email: 'sa@carlos-erp-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nMIIabc\\n-----END PRIVATE KEY-----\\n',
});

describe('buildFirebaseAdmin', () => {
  describe('when no credentials are configured', () => {
    it('returns a disabled no-op client without throwing', async () => {
      const logger = silentLogger();
      const sdkLoader = vi.fn();

      const admin = await buildFirebaseAdmin(makeEnv(), { logger, sdkLoader });

      expect(admin).toBeInstanceOf(DisabledFirebaseAdmin);
      expect(admin.isEnabled).toBe(false);
      expect(admin.projectId).toBeUndefined();
      // The SDK is never loaded on the disabled path.
      expect(sdkLoader).not.toHaveBeenCalled();
    });

    it('logs a single info line explaining Firebase is disabled', async () => {
      const logger = silentLogger();

      await buildFirebaseAdmin(makeEnv(), { logger });

      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        { firebase: 'disabled' },
        expect.stringContaining('disabled'),
      );
    });

    it('throws FirebaseDisabledError if a service is accessed anyway', async () => {
      const admin = await buildFirebaseAdmin(makeEnv(), { logger: silentLogger() });

      expect(() => admin.auth()).toThrow(FirebaseDisabledError);
      expect(() => admin.messaging()).toThrow(FirebaseDisabledError);
      expect(() => admin.remoteConfig()).toThrow(FirebaseDisabledError);
    });

    it('treats blank/whitespace credential values as absent', async () => {
      const admin = await buildFirebaseAdmin(
        makeEnv({ FIREBASE_SERVICE_ACCOUNT: '   ', FIREBASE_SERVICE_ACCOUNT_PATH: '' }),
        { logger: silentLogger() },
      );

      expect(admin.isEnabled).toBe(false);
    });
  });

  describe('when a valid service account JSON is provided', () => {
    it('initializes the SDK and reports enabled', async () => {
      const { sdk, calls } = makeFakeSdk();
      const logger = silentLogger();

      const admin = await buildFirebaseAdmin(
        makeEnv({ FIREBASE_SERVICE_ACCOUNT: VALID_SERVICE_ACCOUNT }),
        { sdkLoader: async () => sdk, logger },
      );

      expect(admin).toBeInstanceOf(EnabledFirebaseAdmin);
      expect(admin.isEnabled).toBe(true);
      expect(admin.projectId).toBe('carlos-erp-test');
      expect(calls.cert).toHaveLength(1);
      expect(calls.initializeApp).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith(
        { firebase: 'enabled', projectId: 'carlos-erp-test' },
        expect.stringContaining('initialized'),
      );
    });

    it('expands escaped newlines in the private key before passing to cert', async () => {
      const { sdk, calls } = makeFakeSdk();

      await buildFirebaseAdmin(makeEnv({ FIREBASE_SERVICE_ACCOUNT: VALID_SERVICE_ACCOUNT }), {
        sdkLoader: async () => sdk,
        logger: silentLogger(),
      });

      const cert = calls.cert[0] as { privateKey: string };
      expect(cert.privateKey).toContain('\n');
      expect(cert.privateKey).not.toContain('\\n');
    });

    it('lets FIREBASE_PROJECT_ID override the embedded project_id', async () => {
      const { sdk } = makeFakeSdk();

      const admin = await buildFirebaseAdmin(
        makeEnv({
          FIREBASE_SERVICE_ACCOUNT: VALID_SERVICE_ACCOUNT,
          FIREBASE_PROJECT_ID: 'carlos-erp-production',
        }),
        { sdkLoader: async () => sdk, logger: silentLogger() },
      );

      expect(admin.projectId).toBe('carlos-erp-production');
    });

    it('exposes the auth/messaging/remoteConfig services bound to the app', async () => {
      const { sdk } = makeFakeSdk();

      const admin = await buildFirebaseAdmin(
        makeEnv({ FIREBASE_SERVICE_ACCOUNT: VALID_SERVICE_ACCOUNT }),
        { sdkLoader: async () => sdk, logger: silentLogger() },
      );

      expect(admin.auth()).toEqual({ service: 'auth', app: { __app: true } });
      expect(admin.messaging()).toEqual({ service: 'messaging', app: { __app: true } });
      expect(admin.remoteConfig()).toEqual({ service: 'remoteConfig', app: { __app: true } });
    });

    it('reuses an already-initialized app to guard against re-init', async () => {
      const { sdk, calls } = makeFakeSdk();
      const existingApp = { __existing: true };
      sdk.apps = [existingApp];

      const admin = await buildFirebaseAdmin(
        makeEnv({ FIREBASE_SERVICE_ACCOUNT: VALID_SERVICE_ACCOUNT }),
        { sdkLoader: async () => sdk, logger: silentLogger() },
      );

      expect(calls.initializeApp).toHaveLength(0);
      expect(admin.auth()).toEqual({ service: 'auth', app: existingApp });
    });
  });

  describe('when the service account is loaded from a file path', () => {
    it('reads and initializes from FIREBASE_SERVICE_ACCOUNT_PATH', async () => {
      const { sdk } = makeFakeSdk();
      const readFile = vi.fn().mockReturnValue(VALID_SERVICE_ACCOUNT);

      const admin = await buildFirebaseAdmin(
        makeEnv({ FIREBASE_SERVICE_ACCOUNT_PATH: '/secrets/firebase.json' }),
        { sdkLoader: async () => sdk, logger: silentLogger(), readFile },
      );

      expect(readFile).toHaveBeenCalledWith('/secrets/firebase.json');
      expect(admin.isEnabled).toBe(true);
    });

    it('throws a clear ValidationError when the file cannot be read', async () => {
      const readFile = vi.fn(() => {
        throw new Error('ENOENT: no such file');
      });

      await expect(
        buildFirebaseAdmin(makeEnv({ FIREBASE_SERVICE_ACCOUNT_PATH: '/missing.json' }), {
          logger: silentLogger(),
          readFile,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('when the credentials are invalid', () => {
    it('throws a clear ValidationError for malformed JSON', async () => {
      await expect(
        buildFirebaseAdmin(makeEnv({ FIREBASE_SERVICE_ACCOUNT: '{ not json ' }), {
          logger: silentLogger(),
        }),
      ).rejects.toThrow(/valid JSON service account/i);
    });

    it('throws a ValidationError listing missing required fields', async () => {
      const incomplete = JSON.stringify({ project_id: 'carlos-erp-test' });

      await expect(
        buildFirebaseAdmin(makeEnv({ FIREBASE_SERVICE_ACCOUNT: incomplete }), {
          logger: silentLogger(),
        }),
      ).rejects.toThrow(/missing required field\(s\): client_email, private_key/i);
    });

    it('rejects a non-object JSON payload', async () => {
      await expect(
        buildFirebaseAdmin(makeEnv({ FIREBASE_SERVICE_ACCOUNT: '"a string"' }), {
          logger: silentLogger(),
        }),
      ).rejects.toThrow(/expected a JSON object/i);
    });
  });
});
