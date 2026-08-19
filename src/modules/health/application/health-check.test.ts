import { describe, expect, it } from 'vitest';
import {
  HealthCheckRegistry,
  PingHealthCheck,
  createDatabaseHealthCheck,
  type HealthCheckResult,
  type IHealthCheck,
} from './health-check.js';

/** A controllable check for exercising the registry aggregation/timeout logic. */
function fakeCheck(
  name: string,
  result: HealthCheckResult | (() => Promise<HealthCheckResult>),
  critical = true,
): IHealthCheck {
  return {
    name,
    critical,
    check: typeof result === 'function' ? result : async () => result,
  };
}

describe('HealthCheckRegistry', () => {
  it('reports ready with an empty checks map when no checks are registered', async () => {
    const registry = new HealthCheckRegistry();

    const report = await registry.runAll();

    expect(report.status).toBe('ready');
    expect(report.checks).toEqual({});
    expect(report.details).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('aggregates to ready when every critical check is up', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(fakeCheck('database', { status: 'up' }));
    registry.register(fakeCheck('redis', { status: 'up' }, false));

    const report = await registry.runAll();

    expect(report.status).toBe('ready');
    expect(report.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('aggregates to not_ready when a critical check is down', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(fakeCheck('database', { status: 'down', detail: 'connection refused' }));
    registry.register(fakeCheck('redis', { status: 'up' }, false));

    const report = await registry.runAll();

    expect(report.status).toBe('not_ready');
    expect(report.checks).toEqual({ database: 'down', redis: 'up' });
    expect(report.details).toEqual({ database: 'connection refused' });
  });

  it('stays ready when only a NON-critical check is down', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(fakeCheck('database', { status: 'up' }));
    registry.register(fakeCheck('redis', { status: 'down', detail: 'redis unavailable' }, false));

    const report = await registry.runAll();

    expect(report.status).toBe('ready');
    expect(report.checks).toEqual({ database: 'up', redis: 'down' });
  });

  it('coerces a rejected check into a down result', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(
      fakeCheck('database', async () => {
        throw new Error('boom');
      }),
    );

    const report = await registry.runAll();

    expect(report.status).toBe('not_ready');
    expect(report.checks.database).toBe('down');
    expect(report.details?.database).toBe('boom');
  });

  it('marks a check that exceeds the timeout as down without hanging', async () => {
    const registry = new HealthCheckRegistry();
    registry.register(
      fakeCheck(
        'database',
        () =>
          new Promise<HealthCheckResult>((resolve) => {
            // Never resolves within the timeout window.
            setTimeout(() => resolve({ status: 'up' }), 1000);
          }),
      ),
    );

    const report = await registry.runAll(20);

    expect(report.status).toBe('not_ready');
    expect(report.checks.database).toBe('down');
    expect(report.details?.database).toContain('timeout');
  });

  it('replaces a check registered under the same name', () => {
    const registry = new HealthCheckRegistry();
    registry.register(fakeCheck('database', { status: 'up' }));
    registry.register(fakeCheck('database', { status: 'down' }));

    expect(registry.size).toBe(1);
    expect(registry.has('database')).toBe(true);
  });
});

describe('PingHealthCheck', () => {
  it('is up when the ping resolves', async () => {
    const check = new PingHealthCheck('redis', async () => 'PONG', { critical: false });

    expect(check.name).toBe('redis');
    expect(check.critical).toBe(false);
    await expect(check.check()).resolves.toEqual({ status: 'up' });
  });

  it('is down with the error message when the ping rejects', async () => {
    const check = new PingHealthCheck('redis', async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(check.check()).resolves.toEqual({ status: 'down', detail: 'ECONNREFUSED' });
  });

  it('defaults to critical when no option is provided', () => {
    const check = new PingHealthCheck('database', async () => undefined);
    expect(check.critical).toBe(true);
  });
});

describe('createDatabaseHealthCheck', () => {
  it('builds a critical check named "database" that is up when the pinger resolves', async () => {
    const check = createDatabaseHealthCheck(async () => [{ '?column?': 1 }]);

    expect(check.name).toBe('database');
    expect(check.critical).toBe(true);
    await expect(check.check()).resolves.toEqual({ status: 'up' });
  });

  it('is down when the database pinger rejects', async () => {
    const check = createDatabaseHealthCheck(async () => {
      throw new Error('database unreachable');
    });

    await expect(check.check()).resolves.toEqual({
      status: 'down',
      detail: 'database unreachable',
    });
  });
});
