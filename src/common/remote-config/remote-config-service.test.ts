import { describe, it, expect, vi } from 'vitest';
import type { IFirebaseAdmin } from '@infrastructure/firebase/index.js';
import {
  FirebaseRemoteConfigService,
  StaticRemoteConfigService,
  type IRemoteConfigService,
  type RemoteConfigLogger,
} from './remote-config-service.js';

/**
 * Builds a fake {@link IFirebaseAdmin}. When `remoteConfig` is provided the
 * client is ENABLED and its accessor returns that fake SDK; otherwise it is a
 * DISABLED client whose `remoteConfig()` throws (as the real disabled client
 * does), so the service must never call it on the disabled path.
 */
function createFirebaseAdmin(remoteConfig?: unknown): IFirebaseAdmin {
  const enabled = remoteConfig !== undefined;
  return {
    isEnabled: enabled,
    projectId: enabled ? 'carlos-test' : undefined,
    auth: () => {
      throw new Error('not used');
    },
    messaging: () => {
      throw new Error('not used');
    },
    remoteConfig: () => {
      if (!enabled) {
        throw new Error('Firebase is disabled');
      }
      return remoteConfig;
    },
  };
}

/**
 * Builds a fake server-side Remote Config SDK surface
 * (`getServerTemplate → evaluate → ServerConfig`) backed by a value map. The
 * `getAll` values are wrapped as SDK-style `Value` objects (with `asString`) to
 * exercise the coercion path.
 */
function createFakeRemoteConfigSdk(values: {
  booleans?: Record<string, boolean>;
  strings?: Record<string, string>;
  numbers?: Record<string, number>;
  all?: Record<string, string>;
}): { getServerTemplate: ReturnType<typeof vi.fn> } {
  const serverConfig = {
    getBoolean(key: string): boolean {
      if (values.booleans === undefined || !(key in values.booleans)) {
        throw new Error(`no boolean for ${key}`);
      }
      return values.booleans[key] as boolean;
    },
    getString(key: string): string {
      if (values.strings === undefined || !(key in values.strings)) {
        throw new Error(`no string for ${key}`);
      }
      return values.strings[key] as string;
    },
    getNumber(key: string): number {
      if (values.numbers === undefined || !(key in values.numbers)) {
        throw new Error(`no number for ${key}`);
      }
      return values.numbers[key] as number;
    },
    getAll(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values.all ?? {})) {
        out[key] = { asString: () => value };
      }
      return out;
    },
  };
  const template = { evaluate: () => serverConfig };
  return { getServerTemplate: vi.fn(async () => template) };
}

describe('FirebaseRemoteConfigService (Firebase disabled)', () => {
  it('returns the supplied defaults for every accessor and never touches the SDK', async () => {
    const admin = createFirebaseAdmin(); // disabled
    const remoteConfigSpy = vi.spyOn(admin, 'remoteConfig');
    const service: IRemoteConfigService = new FirebaseRemoteConfigService(admin);

    await expect(service.getBoolean('flag', true)).resolves.toBe(true);
    await expect(service.getBoolean('flag', false)).resolves.toBe(false);
    await expect(service.getString('name', 'fallback')).resolves.toBe('fallback');
    await expect(service.getNumber('limit', 42)).resolves.toBe(42);
    await expect(service.isFeatureEnabled('new_checkout')).resolves.toBe(false);
    await expect(service.isFeatureEnabled('new_checkout', true)).resolves.toBe(true);
    await expect(service.getAll()).resolves.toEqual({});

    expect(remoteConfigSpy).not.toHaveBeenCalled();
  });
});

describe('FirebaseRemoteConfigService (Firebase enabled)', () => {
  it('returns parsed values from the evaluated server template', async () => {
    const sdk = createFakeRemoteConfigSdk({
      booleans: { new_checkout: true, legacy: false },
      strings: { welcome_message: 'Hola' },
      numbers: { max_items: 25 },
    });
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk));

    await expect(service.getBoolean('new_checkout', false)).resolves.toBe(true);
    await expect(service.getBoolean('legacy', true)).resolves.toBe(false);
    await expect(service.isFeatureEnabled('new_checkout')).resolves.toBe(true);
    await expect(service.getString('welcome_message', 'Hi')).resolves.toBe('Hola');
    await expect(service.getNumber('max_items', 10)).resolves.toBe(25);
  });

  it('returns the default when a key is missing from the template', async () => {
    const sdk = createFakeRemoteConfigSdk({ booleans: { known: true } });
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk));

    await expect(service.getBoolean('unknown_flag', false)).resolves.toBe(false);
    await expect(service.getString('unknown_key', 'def')).resolves.toBe('def');
    await expect(service.getNumber('unknown_num', 7)).resolves.toBe(7);
  });

  it('returns the default when getNumber yields a non-finite value', async () => {
    const sdk = createFakeRemoteConfigSdk({ numbers: { rate: Number.NaN } });
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk));

    await expect(service.getNumber('rate', 3)).resolves.toBe(3);
  });

  it('getAll coerces every parameter value to a string', async () => {
    const sdk = createFakeRemoteConfigSdk({
      all: { feature_a: 'true', greeting: 'hello', limit: '100' },
    });
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk));

    await expect(service.getAll()).resolves.toEqual({
      feature_a: 'true',
      greeting: 'hello',
      limit: '100',
    });
  });

  it('fetches and evaluates the server template only once (caches the result)', async () => {
    const sdk = createFakeRemoteConfigSdk({ booleans: { a: true, b: false } });
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk));

    await service.getBoolean('a', false);
    await service.getBoolean('b', true);
    await service.getAll();

    expect(sdk.getServerTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('FirebaseRemoteConfigService (error handling)', () => {
  it('falls back to defaults and warns when the template fetch rejects', async () => {
    const sdk = {
      getServerTemplate: vi.fn(async () => {
        throw new Error('network down');
      }),
    };
    const logger: RemoteConfigLogger & { warns: Record<string, unknown>[] } = {
      warns: [],
      warn(obj) {
        this.warns.push(obj);
      },
    };
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk), logger);

    await expect(service.getBoolean('flag', true)).resolves.toBe(true);
    await expect(service.getString('key', 'd')).resolves.toBe('d');
    await expect(service.getAll()).resolves.toEqual({});

    expect(logger.warns.length).toBeGreaterThanOrEqual(1);
    expect(logger.warns[0]).toMatchObject({ remoteConfig: 'fetch_failed' });
  });

  it('retries the fetch on a later call after a transient failure', async () => {
    let attempts = 0;
    const goodTemplate = { evaluate: () => ({
      getBoolean: () => true,
      getString: () => '',
      getNumber: () => 0,
      getAll: () => ({}),
    }) };
    const sdk = {
      getServerTemplate: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient');
        }
        return goodTemplate;
      }),
    };
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk));

    await expect(service.getBoolean('flag', false)).resolves.toBe(false); // 1st fails → default
    await expect(service.getBoolean('flag', false)).resolves.toBe(true); // 2nd succeeds
    expect(sdk.getServerTemplate).toHaveBeenCalledTimes(2);
  });

  it('falls back to defaults when the SDK surface is not the expected shape', async () => {
    // remoteConfig() returns an object without getServerTemplate.
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin({ notTheSdk: true }));

    await expect(service.getBoolean('flag', true)).resolves.toBe(true);
    await expect(service.getNumber('n', 9)).resolves.toBe(9);
  });

  it('does not throw when an accessor itself throws mid-evaluation', async () => {
    const badConfig = {
      getBoolean: () => {
        throw new Error('boom');
      },
      getString: () => 'ok',
      getNumber: () => 1,
      getAll: () => {
        throw new Error('boom');
      },
    };
    const sdk = { getServerTemplate: vi.fn(async () => ({ evaluate: () => badConfig })) };
    const service = new FirebaseRemoteConfigService(createFirebaseAdmin(sdk));

    await expect(service.getBoolean('x', false)).resolves.toBe(false);
    await expect(service.getAll()).resolves.toEqual({});
  });
});

describe('StaticRemoteConfigService', () => {
  it('always returns the caller-supplied default', async () => {
    const service = new StaticRemoteConfigService();

    await expect(service.getBoolean('a', true)).resolves.toBe(true);
    await expect(service.getBoolean('a', false)).resolves.toBe(false);
    await expect(service.getString('b', 'x')).resolves.toBe('x');
    await expect(service.getNumber('c', 5)).resolves.toBe(5);
    await expect(service.isFeatureEnabled('d')).resolves.toBe(false);
    await expect(service.isFeatureEnabled('d', true)).resolves.toBe(true);
  });

  it('exposes the optional static map via getAll (defaulting to empty)', async () => {
    await expect(new StaticRemoteConfigService().getAll()).resolves.toEqual({});

    const seeded = new StaticRemoteConfigService({ flag_a: 'true', region: 'sa-east-1' });
    await expect(seeded.getAll()).resolves.toEqual({ flag_a: 'true', region: 'sa-east-1' });
  });

  it('returns a copy from getAll (callers cannot mutate the backing map)', async () => {
    const seeded = new StaticRemoteConfigService({ k: 'v' });
    const all = await seeded.getAll();
    all.k = 'mutated';
    await expect(seeded.getAll()).resolves.toEqual({ k: 'v' });
  });
});
