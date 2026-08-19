import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/** Maximum length accepted for a normalised SKU. */
export const SKU_MAX_LENGTH = 64;

/**
 * Allowed SKU character set after normalisation: upper-case letters, digits,
 * hyphen and underscore. This keeps SKUs URL- and barcode-friendly while still
 * permitting common separators.
 */
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

/** Internal attributes of a {@link Sku}. */
interface SkuProps {
  value: string;
}

/**
 * Stock Keeping Unit value object.
 *
 * A SKU is a tenant-scoped product code. Uniqueness *per tenant* is enforced at
 * the repository / use-case level (`@@unique([tenantId, sku])`, task 13.2); this
 * value object only guarantees the code is well-formed and normalised so two
 * equivalent inputs (`"abc-1"` / `" ABC-1 "`) compare equal.
 */
export class Sku extends ValueObject<SkuProps> {
  private constructor(props: SkuProps) {
    super(props);
  }

  /**
   * Creates a normalised {@link Sku} (trimmed + upper-cased).
   *
   * @throws {ValidationError} when the value is empty, too long, or contains
   *   characters outside the allowed set.
   */
  static create(value: string): Sku {
    if (typeof value !== 'string') {
      throw new ValidationError('SKU is required', { value });
    }
    const normalized = value.trim().toUpperCase();
    if (normalized.length === 0) {
      throw new ValidationError('SKU cannot be empty', { value });
    }
    if (normalized.length > SKU_MAX_LENGTH) {
      throw new ValidationError(`SKU cannot exceed ${SKU_MAX_LENGTH} characters`, { value });
    }
    if (!SKU_PATTERN.test(normalized)) {
      throw new ValidationError(
        'SKU may only contain letters, digits, hyphens and underscores',
        { value },
      );
    }
    return new Sku({ value: normalized });
  }

  /** The normalised SKU string. */
  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
