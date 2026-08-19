/**
 * A strongly-typed key used to register and resolve a dependency.
 *
 * The phantom `_type` field carries the resolved value's type at compile time
 * without ever existing at runtime, enabling `container.resolve(token)` to be
 * fully type-safe while remaining a plain object key (Requirement 3.2).
 *
 * @typeParam T - The type produced when this token is resolved.
 */
export class InjectionToken<T> {
  /** Phantom type marker — never assigned, exists only for inference. */
  declare private readonly _type: T;

  /** @param description - Human-readable name used in diagnostics. */
  constructor(public readonly description: string) {}

  /** Returns the token description for logging/debugging. */
  toString(): string {
    return `InjectionToken(${this.description})`;
  }
}

/** Convenience factory for declaring a typed {@link InjectionToken}. */
export function createToken<T>(description: string): InjectionToken<T> {
  return new InjectionToken<T>(description);
}
