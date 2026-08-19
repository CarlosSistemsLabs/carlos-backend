import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/** Maximum length accepted for a normalised email address (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/** Internal attributes of an {@link Email}. */
interface EmailProps {
  value: string;
}

/**
 * Email address value object (Suppliers module).
 *
 * Duplicated intentionally inside the Suppliers bounded context rather than
 * imported from the Customers or Auth modules: modules communicate only through
 * their public façade and never reach into another module's internals. A small,
 * module-local value object keeps the boundary clean and lets the contexts
 * evolve their validation independently.
 *
 * On a {@link Supplier} the email is *optional*; the absence of an address is
 * modelled as `null` on the entity, so this value object always represents a
 * present, well-formed address. It normalises to lower-case + trimmed so two
 * equivalent inputs (`"A@B.COM"` / `" a@b.com "`) compare equal.
 */
export class Email extends ValueObject<EmailProps> {
  // Pragmatic single-line email pattern: local@domain.tld with no spaces.
  private static readonly PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  private constructor(props: EmailProps) {
    super(props);
  }

  /**
   * Creates a validated, normalised {@link Email}.
   *
   * @throws {ValidationError} when the value is empty, too long, or malformed.
   */
  static create(value: string): Email {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError('Email is required', { field: 'email' });
    }

    const normalized = value.trim().toLowerCase();

    if (normalized.length > EMAIL_MAX_LENGTH) {
      throw new ValidationError('Email exceeds the maximum allowed length', {
        field: 'email',
        maxLength: EMAIL_MAX_LENGTH,
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
