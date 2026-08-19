import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

interface PasswordProps {
  value: string;
}

/**
 * Plain-text password value object.
 *
 * Encapsulates the password strength policy so the rules live in one place and
 * are enforced before a password is ever hashed. The raw value is held only
 * transiently inside the domain; it is never persisted (only its hash is) and
 * must not be logged.
 */
export class Password extends ValueObject<PasswordProps> {
  static readonly MIN_LENGTH = 8;
  static readonly MAX_LENGTH = 128;

  private constructor(props: PasswordProps) {
    super(props);
  }

  /**
   * Creates a {@link Password} after validating the strength policy: 8-128
   * characters, with at least one lower-case letter, one upper-case letter and
   * one digit.
   *
   * @throws {ValidationError} when the policy is not satisfied.
   */
  static create(value: string): Password {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationError('Password is required', { field: 'password' });
    }

    if (value.length < Password.MIN_LENGTH || value.length > Password.MAX_LENGTH) {
      throw new ValidationError(
        `Password must be between ${Password.MIN_LENGTH} and ${Password.MAX_LENGTH} characters`,
        { field: 'password', minLength: Password.MIN_LENGTH, maxLength: Password.MAX_LENGTH },
      );
    }

    if (!/[a-z]/.test(value)) {
      throw new ValidationError('Password must contain a lower-case letter', {
        field: 'password',
      });
    }

    if (!/[A-Z]/.test(value)) {
      throw new ValidationError('Password must contain an upper-case letter', {
        field: 'password',
      });
    }

    if (!/[0-9]/.test(value)) {
      throw new ValidationError('Password must contain a digit', { field: 'password' });
    }

    return new Password({ value });
  }

  /** The raw password value. Never persist or log this. */
  get value(): string {
    return this.props.value;
  }
}
