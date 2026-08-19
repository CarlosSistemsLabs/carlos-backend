import { describe, it, expect, beforeEach } from 'vitest';
import { DomainError } from '@domain/errors/index.js';
import { PluginRegistry } from './plugin-registry.js';
import { DuplicatePluginError, PluginError } from './plugin-errors.js';
import { PluginType } from './plugin.js';
import type { IPlugin, PluginContext, PluginMetadata } from './plugin.js';

/**
 * A tiny fake plugin implementing the full {@link IPlugin} lifecycle. The
 * registry only inspects `metadata`, so the lifecycle methods are inert no-ops
 * that record whether they ran.
 */
class FakePlugin implements IPlugin {
  public initialized = false;
  public active = false;

  constructor(public readonly metadata: PluginMetadata) {}

  async initialize(_context: PluginContext): Promise<void> {
    this.initialized = true;
  }

  async activate(): Promise<void> {
    this.active = true;
  }

  async deactivate(): Promise<void> {
    this.active = false;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.active = false;
  }
}

function makePlugin(id: string, type: PluginType = PluginType.Payment): FakePlugin {
  return new FakePlugin({ id, name: id, version: '1.0.0', type });
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('starts empty', () => {
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it('registers and resolves a plugin by id', () => {
    const plugin = makePlugin('mercadopago');
    registry.register(plugin);

    expect(registry.has('mercadopago')).toBe(true);
    expect(registry.get('mercadopago')).toBe(plugin);
    expect(registry.size).toBe(1);
  });

  it('returns undefined when resolving a missing plugin', () => {
    expect(registry.get('does-not-exist')).toBeUndefined();
    expect(registry.has('does-not-exist')).toBe(false);
  });

  it('rejects duplicate registration with a descriptive domain error', () => {
    registry.register(makePlugin('stripe'));

    let thrown: unknown;
    try {
      registry.register(makePlugin('stripe'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DuplicatePluginError);
    expect(thrown).toBeInstanceOf(PluginError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DuplicatePluginError).message).toContain('stripe');
    expect((thrown as DuplicatePluginError).details).toEqual({ pluginId: 'stripe' });
    // The original registration is preserved, not overwritten.
    expect(registry.size).toBe(1);
  });

  it('unregisters a plugin and reports whether one was removed', () => {
    registry.register(makePlugin('whatsapp', PluginType.Messaging));

    expect(registry.unregister('whatsapp')).toBe(true);
    expect(registry.has('whatsapp')).toBe(false);
    expect(registry.size).toBe(0);
    // Unregistering a missing plugin is a no-op returning false.
    expect(registry.unregister('whatsapp')).toBe(false);
  });

  it('lists every registered plugin as a defensive snapshot', () => {
    const a = makePlugin('a');
    const b = makePlugin('b');
    registry.register(a);
    registry.register(b);

    const listed = registry.list();
    expect(listed).toHaveLength(2);
    expect(listed).toContain(a);
    expect(listed).toContain(b);

    // Mutating the returned array must not affect the registry.
    listed.pop();
    expect(registry.size).toBe(2);
  });

  it('lists plugins filtered by type', () => {
    const payment = makePlugin('mercadopago', PluginType.Payment);
    const messaging = makePlugin('whatsapp', PluginType.Messaging);
    const ai = makePlugin('openai', PluginType.AI);
    registry.register(payment);
    registry.register(messaging);
    registry.register(ai);

    expect(registry.listByType(PluginType.Payment)).toEqual([payment]);
    expect(registry.listByType(PluginType.Messaging)).toEqual([messaging]);
    expect(registry.listByType(PluginType.AI)).toEqual([ai]);
    expect(registry.listByType(PluginType.Ecommerce)).toEqual([]);
  });

  it('clears all registrations', () => {
    registry.register(makePlugin('a'));
    registry.register(makePlugin('b'));

    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });
});
