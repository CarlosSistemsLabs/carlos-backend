import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/** Internal attributes of a {@link BrandColor}. */
interface BrandColorProps {
  value: string;
}

/**
 * Brand colour value object (Administration module — Requirement 11.1).
 *
 * A tenant's primary/secondary colours are optional; absence is modelled as
 * `null` on the {@link Tenant} entity, so this value object always represents a
 * present, well-formed CSS hex colour. It accepts the shorthand 3-digit
 * (`#f0a`) and the full 6-digit (`#ff00aa`) forms and normalises to a
 * lower-cased, `#`-prefixed string so two equivalent inputs (`"#FF00AA"` /
 * `" #ff00aa "`) compare equal. The shorthand form is expanded to its 6-digit
 * canonical form so the stored value is unambiguous for every client platform.
 */
export class BrandColor extends ValueObject<BrandColorProps> {
  // #RGB or #RRGGBB (case-insensitive); the leading `#` is required.
  private static readonly PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;

  private constructor(props: BrandColorProps) {
    super(props);
  }

  /**
   * Creates a validated, normalised {@link BrandColor}.
   *
   * @throws {ValidationError} when the value is empty or is not a valid
   *   3- or 6-digit hex colour.
   */
  static create(value: string): BrandColor {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError('Color is required', { field: 'color' });
    }

    const normalized = value.trim().toLowerCase();

    if (!BrandColor.PATTERN.test(normalized)) {
      throw new ValidationError('Color must be a valid hex value (e.g. "#1a2b3c" or "#abc")', {
        field: 'color',
        value,
      });
    }

    return new BrandColor({ value: BrandColor.expand(normalized) });
  }

  /** Expands the 3-digit shorthand (`#f0a`) to its 6-digit form (`#ff00aa`). */
  private static expand(hex: string): string {
    if (hex.length === 4) {
      const [, r, g, b] = hex;
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return hex;
  }

  /** The normalised (`#`-prefixed, lower-cased, 6-digit) hex colour. */
  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
