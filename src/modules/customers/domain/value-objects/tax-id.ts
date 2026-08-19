import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/** Inclusive length bounds for a normalised tax identifier. */
export const TAX_ID_MIN_LENGTH = 4;
export const TAX_ID_MAX_LENGTH = 32;

/**
 * Allowed tax-id character set after normalisation: upper-case letters, digits
 * and hyphens. This accommodates common formats (e.g. Argentine CUIT
 * `20-12345678-9`, generic VAT numbers) without hard-coding a single
 * jurisdiction's checksum rules.
 */
const TAX_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;

/** Internal attributes of a {@link TaxId}. */
interface TaxIdProps {
  value: string;
}

/**
 * Tax identifier value object (Customers module).
 *
 * On a {@link Customer} the tax id is *optional*; absence is modelled as `null`
 * on the entity, so this value object always represents a present, well-formed
 * identifier. It normalises to trimmed + upper-cased so two equivalent inputs
 * (`"20-12345678-9"` / `" 20-12345678-9 "`) compare equal. Jurisdiction-specific
 * checksum validation is intentionally out of scope here.
 */
export class TaxId extends ValueObject<TaxIdProps> {
  private constructor(props: TaxIdProps) {
    super(props);
  }

  /**
   * Creates a validated, normalised {@link TaxId}.
   *
   * @throws {ValidationError} when the value is empty, out of the allowed
   *   length range, or contains characters outside the allowed set.
   */
  static create(value: string): TaxId {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError('Tax ID is required', { field: 'taxId' });
    }

    const normalized = value.trim().toUpperCase();

    if (normalized.length < TAX_ID_MIN_LENGTH || normalized.length > TAX_ID_MAX_LENGTH) {
      throw new ValidationError(
        `Tax ID must be between ${TAX_ID_MIN_LENGTH} and ${TAX_ID_MAX_LENGTH} characters`,
        { field: 'taxId' },
      );
    }

    if (!TAX_ID_PATTERN.test(normalized)) {
      throw new ValidationError('Tax ID may only contain letters, digits and hyphens', {
        field: 'taxId',
      });
    }

    return new TaxId({ value: normalized });
  }

  /** The normalised (trimmed, upper-cased) tax identifier. */
  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
