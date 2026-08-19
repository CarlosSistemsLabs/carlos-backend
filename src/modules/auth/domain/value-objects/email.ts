import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

interface EmailProps {
  value: string;
}

/**
 * Email address value object.
 *
 * Normalises the address to lower-case and trims surrounding whitespace, then
 * enforces a pragmatic RFC-5322-subset format. Equality is value-based, so two
 * {@link Email} instances with the same normalised address are equal.
 */
export class Email extends ValueObject<EmailProps> {
  // Pragmatic single-line email pattern: local@domain.tld with no spaces.
  private static readonly PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private static readonly MAX_LENGTH = 254;

  private constructor(props: EmailProps) {
    super(props);
  }

  /**
   * Creates a validated {@link Email}.
   *
   * @throws {ValidationError} when the value is empty, too long, or malformed.
   */
  static create(value: string): Email {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError('Email is required', { field: 'email' });
    }

    const normalized = value.trim().toLowerCase();

    if (normalized.length > Email.MAX_LENGTH) {
      throw new ValidationError('Email exceeds the maximum allowed length', {
        field: 'email',
        maxLength: Email.MAX_LENGTH,
      });
    }

    if (!Email.PATTERN.test(normalized)) {
      throw new ValidationError('Email format is invalid', { field: 'email' });
    }

    return new Email({ value: normalized });
  }

  /** The normalised (trimmed, lower-cased) email address. */
  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
