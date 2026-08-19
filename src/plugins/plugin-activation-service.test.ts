import { describe, it, expect, vi } from 'vitest';
import {
  PluginActivationService,
  defaultPluginFeatureKey,
  type PluginFeatureAccess,
} from './plugin-activation-service.js';
import { PluginType } from './plugin.js';
import type { IPlugin, PluginContext, PluginLogger, PluginMetadata } from './plugin.js';

function makeLogger(): {
  logger: PluginLogger;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const error = vi.fn();
  return { logger: { info, warn: vi.fn(), error }, info, error };
}

/**
 * A fake feature-access port. Structurally identical to the Subscriptions
 * `IFeatureAccessService`, so the same instance would bind at the composition
 * root; here it returns a fixed map of enabled features.
 */
function makeFeatureAccess(enabled: Record<string, boolean>): {
  featureAccess: PluginFeatureAccess;
  isFeatureEnabled: ReturnType<typeof vi.fn>;
} {
  const isFeatureEnabled = vi.fn(async (_tenantId: string, feature: string) => enabled[feature] ?? false);
  return { featureAccess: { isFeatureEnabled }, isFeatureEnabled };
}

class FakePlugin implements IPlugin {
  public readonly calls: string[] = [];

  constructor(
    public readonly metadata: PluginMetadata,
    private readonly failAt?: 'activate' | 'deactivate',
  ) {}

  async initialize(_context: PluginContext): Promise<void> {
    this.calls.push('initialize');
  }

  async activate(): Promise<void> {
    this.calls.push('activate');
    if (this.failAt === 'activate') {
      throw new Error('activate boom');
    }
  }

  async deactivate(): Promise<void> {
    this.calls.push('deactivate');
    if (this.failAt === 'deactivate') {
      throw new Error('deactivate boom');
    }
  }

  async shutdown(): Promise<void> {
    this.calls.push('shutdown');
  }
}

function meta(id: string): PluginMetadata {
  return { id, name: id, version: '1.0.0', type: PluginType.Payment };
}

describe('PluginActivationService', () => {
  it('derives the default feature-flag key as plugin:{id}', () => {
    expect(defaultPluginFeatureKey(meta('mercadopago'))).toBe('plugin:mercadopago');
  });

  it('reports a plugin active for a tenant when its feature flag is on', async () => {
    const plugin = new FakePlugin(meta('mercadopago'));
    const { featureAccess, isFeatureEnabled } = makeFeatureAccess({ 'plugin:mercadopago': true });
    const { logger } = makeLogger();
    const service = new PluginActivationService({ featureAccess, logger });

    await expect(service.isActiveForTenant(plugin, 'tenant-1')).resolves.toBe(true);
    expect(isFeatureEnabled).toHaveBeenCalledWith('tenant-1', 'plugin:mercadopago');
  });

  it('reports a plugin inactive for a tenant when its feature flag is off', async () => {
    const plugin = new FakePlugin(meta('mercadopago'));
    const { featureAccess } = makeFeatureAccess({ 'plugin:mercadopago': false });
    const { logger } = makeLogger();
    const service = new PluginActivationService({ featureAccess, logger });

    await expect(service.isActiveForTenant(plugin, 'tenant-1')).resolves.toBe(false);
  });

  it('activates the plugin for a tenant only when the flag is enabled', async () => {
    const plugin = new FakePlugin(meta('mercadopago'));
    const { featureAccess } = makeFeatureAccess({ 'plugin:mercadopago': true });
    const { logger } = makeLogger();
    const service = new PluginActivationService({ featureAccess, logger });

    const activated = await service.activateForTenant(plugin, 'tenant-1');

    expect(activated).toBe(true);
    expect(plugin.calls).toEqual(['activate']);
  });

  it('does NOT activate the plugin when the flag is disabled (no lifecycle call)', async () => {
    const plugin = new FakePlugin(meta('mercadopago'));
    const { featureAccess } = makeFeatureAccess({ 'plugin:mercadopago': false });
    const { logger } = makeLogger();
    const service = new PluginActivationService({ featureAccess, logger });

    const activated = await service.activateForTenant(plugin, 'tenant-1');

    expect(activated).toBe(false);
    expect(plugin.calls).toEqual([]);
  });

  it('deactivates the plugin for a tenant', async () => {
    const plugin = new FakePlugin(meta('mercadopago'));
    const { featureAccess } = makeFeatureAccess({});
    const { logger } = makeLogger();
    const service = new PluginActivationService({ featureAccess, logger });

    const deactivated = await service.deactivateForTenant(plugin, 'tenant-1');

    expect(deactivated).toBe(true);
    expect(plugin.calls).toEqual(['deactivate']);
  });

  it('gracefully degrades when activate throws: logs, returns false, does not propagate', async () => {
    const plugin = new FakePlugin(meta('mercadopago'), 'activate');
    const { featureAccess } = makeFeatureAccess({ 'plugin:mercadopago': true });
    const { logger, error } = makeLogger();
    const service = new PluginActivationService({ featureAccess, logger });

    const activated = await service.activateForTenant(plugin, 'tenant-1');

    expect(activated).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('gracefully degrades when deactivate throws: logs, returns false, does not propagate', async () => {
    const plugin = new FakePlugin(meta('mercadopago'), 'deactivate');
    const { featureAccess } = makeFeatureAccess({});
    const { logger, error } = makeLogger();
    const service = new PluginActivationService({ featureAccess, logger });

    const deactivated = await service.deactivateForTenant(plugin, 'tenant-1');

    expect(deactivated).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('honours a custom feature-key convention', async () => {
    const plugin = new FakePlugin(meta('mercadopago'));
    const { featureAccess, isFeatureEnabled } = makeFeatureAccess({ 'integrations.mercadopago': true });
    const { logger } = makeLogger();
    const service = new PluginActivationService({
      featureAccess,
      logger,
      featureKey: (m) => `integrations.${m.id}`,
    });

    await expect(service.isActiveForTenant(plugin, 'tenant-9')).resolves.toBe(true);
    expect(isFeatureEnabled).toHaveBeenCalledWith('tenant-9', 'integrations.mercadopago');
  });
});
