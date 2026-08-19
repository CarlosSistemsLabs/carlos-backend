/**
 * Raised when the dependency injection container is asked to resolve a token
 * that has not been registered, or when a circular dependency is detected
 * during resolution.
 *
 * This is an infrastructure-level error (it concerns wiring, not business
 * rules) and therefore deliberately does not extend the domain error
 * hierarchy.
 */
export class DependencyResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
