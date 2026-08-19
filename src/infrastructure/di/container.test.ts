import { describe, expect, it } from 'vitest';
import { Container } from './container.js';
import { createToken } from './injection-token.js';
import { DependencyResolutionError } from './errors.js';

interface Logger {
  log(message: string): void;
}

interface Service {
  readonly logger: Logger;
  greet(): string;
}

const LOGGER = createToken<Logger>('Logger');
const SERVICE = createToken<Service>('Service');
const COUNTER = createToken<number>('Counter');

describe('Container', () => {
  it('resolves a registered value', () => {
    const container = new Container();
    const logger: Logger = { log: () => undefined };

    container.registerValue(LOGGER, logger);

    expect(container.resolve(LOGGER)).toBe(logger);
  });

  it('resolves a factory and injects dependencies from the container', () => {
    const container = new Container();
    const logger: Logger = { log: () => undefined };
    container.registerValue(LOGGER, logger);
    container.register(SERVICE, (c) => ({
      logger: c.resolve(LOGGER),
      greet: () => 'hello',
    }));

    const service = container.resolve(SERVICE);

    expect(service.greet()).toBe('hello');
    expect(service.logger).toBe(logger);
  });

  it('caches singleton instances (factory invoked once)', () => {
    const container = new Container();
    let invocations = 0;
    container.register(
      COUNTER,
      () => {
        invocations += 1;
        return invocations;
      },
      'singleton',
    );

    const first = container.resolve(COUNTER);
    const second = container.resolve(COUNTER);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(invocations).toBe(1);
  });

  it('invokes the factory on every resolve for transient registrations', () => {
    const container = new Container();
    let invocations = 0;
    container.register(
      COUNTER,
      () => {
        invocations += 1;
        return invocations;
      },
      'transient',
    );

    expect(container.resolve(COUNTER)).toBe(1);
    expect(container.resolve(COUNTER)).toBe(2);
    expect(invocations).toBe(2);
  });

  it('reports registration existence via has()', () => {
    const container = new Container();
    expect(container.has(LOGGER)).toBe(false);
    container.registerValue(LOGGER, { log: () => undefined });
    expect(container.has(LOGGER)).toBe(true);
  });

  it('throws a DependencyResolutionError for an unregistered token', () => {
    const container = new Container();
    expect(() => container.resolve(LOGGER)).toThrowError(DependencyResolutionError);
  });

  it('detects circular dependencies', () => {
    const container = new Container();
    const A = createToken<string>('A');
    const B = createToken<string>('B');
    container.register(A, (c) => c.resolve(B));
    container.register(B, (c) => c.resolve(A));

    expect(() => container.resolve(A)).toThrowError(/Circular dependency/);
  });

  it('clears registrations on reset()', () => {
    const container = new Container();
    container.registerValue(LOGGER, { log: () => undefined });
    container.reset();
    expect(container.has(LOGGER)).toBe(false);
  });

  it('allows re-registration to override an existing token', () => {
    const container = new Container();
    container.registerValue(COUNTER, 1);
    container.registerValue(COUNTER, 2);
    expect(container.resolve(COUNTER)).toBe(2);
  });
});
