import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginRegistry } from './plugin-registry.js';
import { PluginLoader, type PluginConfigResolver, type PluginFactory } from './plugin-loader.js';
import { PluginLoadError, PluginLoadPhase } from './plugin-errors.js';
import { PluginType } from './plugin.js';
import type { IPlugin, PluginContext, PluginLogger, PluginMetadata } from './plugin.js';

/** A silent logger spy capturing structured error/info lines. */
function makeLogger(): {
  logger: PluginLogger;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return { logger: { info, warn, error }, info, warn, error };
}

/**
 * A fake plugin recording lifecycle order and, optionally, throwing at a chosen
 * phase to exercise graceful degradation.
 */
class FakePlugin implements IPlugin {
  public readonly calls: string[] = [];
  public initializedWith?: PluginContext;

  constructor(
    public readonly metadata: PluginMetadata,
    private readonly failAt?: 'initialize' | 'activate',
  ) {}

  async initialize(context: PluginContext): Promise<void> {
    this.calls.push('initialize');
    this.initializedWith = context;
    if (this.failAt === 'initialize') {
      throw new Error(`init boom for ${this.metadata.id}`);
    }
  }

  async activate(): Promise<void> {
    this.calls.push('activate');
    if (this.failAt === 'activate') {
      throw new Error(`activate boom for ${this.metadata.id}`);
    }
  }

  async deactivate(): Promise<void> {
    this.calls.push('deactivate');
  }

  async shutdown(): Promise<void> {
    this.calls.push('shutdown');
  }
}

function meta(id: string, type: PluginType = PluginType.Payment): PluginMetadata {
  return { id, name: id, version: '1.0.0', type };
}

function factoryOf(plugin: IPlugin): PluginFactory {
  return () => plugin;
}

describe('PluginLoader', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('discovers plugins and registers them into the registry', async () => {
    const a = new FakePlugin(meta('mercadopago'));
    const b = new FakePlugin(meta('whatsapp', PluginType.Messaging));
    const { logger } = makeLogger();
    const loader = new PluginLoader({ registry, logger });

    const result = await loader.load([factoryOf(a), factoryOf(b)]);

    expect(registry.has('mercadopago')).toBe(true);
    expect(registry.has('whatsapp')).toBe(true);
    expect(result.loaded).toEqual(['mercadopago', 'whatsapp']);
    expect(result.failed).toEqual([]);
    expect(loader.getFailures()).toEqual([]);
  });

  it('drives initialize before activate for each plugin (ordered lifecycle)', async () => {
    const plugin = new FakePlugin(meta('stripe'));
    const { logger } = makeLogger();
    const loader = new PluginLoader({ registry, logger });

    await loader.load([factoryOf(plugin)]);

    expect(plugin.calls).toEqual(['initialize', 'activate']);
  });

  it('passes resolved config and a logger to each plugin via the context', async () => {
    const plugin = new FakePlugin(meta('openai', PluginType.AI));
    const { logger } = makeLogger();
    const configResolver: PluginConfigResolver = {
      resolve: (id) => ({ apiKey: `key-for-${id}` }),
    };
    const loader = new PluginLoader({ registry, logger, configResolver });

    await loader.load([factoryOf(plugin)]);

    expect(plugin.initializedWith?.config).toEqual({ apiKey: 'key-for-openai' });
    expect(plugin.initializedWith?.logger).toBe(logger);
  });

  it('isolates a plugin that throws during initialize; others still load, no throw', async () => {
    const bad = new FakePlugin(meta('bad-init'), 'initialize');
    const good = new FakePlugin(meta('good'));
    const { logger, error } = makeLogger();
    const loader = new PluginLoader({ registry, logger });

    const result = await loader.load([factoryOf(bad), factoryOf(good)]);

    // The good plugin still loads fully.
    expect(result.loaded).toEqual(['good']);
    expect(good.calls).toEqual(['initialize', 'activate']);
    // The bad plugin never reaches activate.
    expect(bad.calls).toEqual(['initialize']);
    // Its failure is recorded and observable.
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.pluginId).toBe('bad-init');
    expect(result.failed[0]?.phase).toBe(PluginLoadPhase.Initialize);
    expect(result.failed[0]?.error).toBeInstanceOf(PluginLoadError);
    expect(result.failed[0]?.error.cause).toBeInstanceOf(Error);
    expect(loader.hasFailed('bad-init')).toBe(true);
    // And it was logged for observability.
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('isolates a plugin that throws during activate; failure recorded at activate phase', async () => {
    const bad = new FakePlugin(meta('bad-activate'), 'activate');
    const good = new FakePlugin(meta('good'));
    const { logger } = makeLogger();
    const loader = new PluginLoader({ registry, logger });

    const result = await loader.load([factoryOf(good), factoryOf(bad)]);

    expect(result.loaded).toEqual(['good']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.pluginId).toBe('bad-activate');
    expect(result.failed[0]?.phase).toBe(PluginLoadPhase.Activate);
    // The registry still contains it (it was registered before activation failed).
    expect(registry.has('bad-activate')).toBe(true);
  });

  it('isolates a factory that throws (discovery failure) without a plugin instance', async () => {
    const throwingFactory: PluginFactory = () => {
      throw new Error('cannot construct');
    };
    const good = new FakePlugin(meta('good'));
    const { logger } = makeLogger();
    const loader = new PluginLoader({ registry, logger });

    const result = await loader.load([throwingFactory, factoryOf(good)]);

    expect(result.loaded).toEqual(['good']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.phase).toBe(PluginLoadPhase.Discovery);
    expect(result.failed[0]?.pluginId).toBe('<unknown>');
  });

  it('records a duplicate-id registration as a discovery failure and keeps going', async () => {
    const first = new FakePlugin(meta('dup'));
    const second = new FakePlugin(meta('dup'));
    const other = new FakePlugin(meta('other'));
    const { logger } = makeLogger();
    const loader = new PluginLoader({ registry, logger });

    const result = await loader.load([factoryOf(first), factoryOf(second), factoryOf(other)]);

    expect(result.loaded).toEqual(['dup', 'other']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.pluginId).toBe('dup');
    expect(result.failed[0]?.phase).toBe(PluginLoadPhase.Discovery);
  });

  it('clears prior failures on a subsequent load pass', async () => {
    const bad = new FakePlugin(meta('bad-init'), 'initialize');
    const { logger } = makeLogger();
    const loader = new PluginLoader({ registry, logger });

    await loader.load([factoryOf(bad)]);
    expect(loader.hasFailed('bad-init')).toBe(true);

    const fresh = new PluginRegistry();
    const loader2 = new PluginLoader({ registry: fresh, logger });
    const result = await loader2.load([factoryOf(new FakePlugin(meta('good')))]);
    expect(result.failed).toEqual([]);
    expect(loader2.hasFailed('bad-init')).toBe(false);
  });
});
