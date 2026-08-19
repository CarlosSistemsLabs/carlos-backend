import { DependencyResolutionError } from './errors.js';
import type { InjectionToken } from './injection-token.js';

/** Lifecycle strategies supported by the {@link Container}. */
export type Lifecycle = 'singleton' | 'transient';

/**
 * A factory that produces a dependency. It receives the container so it can
 * resolve its own dependencies, enabling constructor-style wiring.
 */
export type FactoryFn<T> = (container: Container) => T;

interface Registration<T> {
  factory: FactoryFn<T>;
  lifecycle: Lifecycle;
  instance?: T;
}

/**
 * A minimal, dependency-free, type-safe inversion-of-control container.
 *
 * It is used as the composition mechanism for the backend so that outer layers
 * depend on domain abstractions rather than concrete infrastructure
 * (dependency inversion, Requirement 3.2). A bespoke container is used instead
 * of a decorator-based library because the project targets strict ESM with
 * `moduleResolution: "Bundler"` and intentionally omits
 * `experimentalDecorators` / `emitDecoratorMetadata`; a hand-rolled registry
 * avoids the `reflect-metadata` runtime polyfill and decorator/ESM friction
 * while remaining fully typed and testable.
 */
export class Container {
  private readonly registrations = new Map<InjectionToken<unknown>, Registration<unknown>>();
  private readonly resolutionStack: InjectionToken<unknown>[] = [];

  /**
   * Registers a factory for a token.
   *
   * @param token - The typed key to register.
   * @param factory - Produces the value; receives the container for wiring.
   * @param lifecycle - `singleton` (default) caches the first instance;
   *   `transient` invokes the factory on every resolve.
   */
  register<T>(
    token: InjectionToken<T>,
    factory: FactoryFn<T>,
    lifecycle: Lifecycle = 'singleton',
  ): this {
    this.registrations.set(token as InjectionToken<unknown>, {
      factory: factory as FactoryFn<unknown>,
      lifecycle,
    });
    return this;
  }

  /** Registers an already-constructed value as a singleton. */
  registerValue<T>(token: InjectionToken<T>, value: T): this {
    this.registrations.set(token as InjectionToken<unknown>, {
      factory: () => value,
      lifecycle: 'singleton',
      instance: value,
    });
    return this;
  }

  /** Returns `true` when a registration exists for the token. */
  has<T>(token: InjectionToken<T>): boolean {
    return this.registrations.has(token as InjectionToken<unknown>);
  }

  /**
   * Resolves the value registered for a token.
   *
   * @throws {DependencyResolutionError} when the token is unregistered or a
   *   circular dependency is detected.
   */
  resolve<T>(token: InjectionToken<T>): T {
    const registration = this.registrations.get(token as InjectionToken<unknown>) as
      | Registration<T>
      | undefined;

    if (registration === undefined) {
      throw new DependencyResolutionError(
        `No registration found for ${token.toString()}`,
      );
    }

    if (registration.lifecycle === 'singleton' && 'instance' in registration) {
      return registration.instance as T;
    }

    if (this.resolutionStack.includes(token as InjectionToken<unknown>)) {
      const cycle = [...this.resolutionStack, token]
        .map((entry) => entry.toString())
        .join(' -> ');
      throw new DependencyResolutionError(`Circular dependency detected: ${cycle}`);
    }

    this.resolutionStack.push(token as InjectionToken<unknown>);
    try {
      const value = registration.factory(this);
      if (registration.lifecycle === 'singleton') {
        registration.instance = value;
      }
      return value;
    } finally {
      this.resolutionStack.pop();
    }
  }

  /** Removes all registrations and cached instances. */
  reset(): void {
    this.registrations.clear();
    this.resolutionStack.length = 0;
  }
}
