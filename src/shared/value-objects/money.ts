import { ValueObject } from '@domain/value-objects/value-object.js';
import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';

/**
 * Shared monetary value object (Requirement 9.1).
 *
 * **Promotion note:** `Money` originally lived inside the Products module. It is
 * genuinely shared domain math (Products *and* Sales — and later Purchases/Cash
 * — all need integer-safe currency arithmetic), so it has been promoted to the
 * shared kernel. The Products module keeps a thin re-export shim at its old path
 * (`modules/products/domain/value-objects/money.js`) so its public API and every
 * existing relative import continue to work unchanged.
 *
 * Number of fractional digits tracked for every monetary amount.
 *
 * **Representation decision:** `Money` stores its value as an **integer number
 * of minor units** (e.g. cents) rather than a floating-point major amount. This
 * eliminates binary floating-point drift entirely — the classic
 * `0.1 + 0.2 !== 0.3` problem cannot occur because all arithmetic happens on
 * integers. Two fractional digits matches the platform's `Decimal(12, 2)`
 * columns, so the in-memory value object and the database column share the same
 * precision.
 *
 * Minor units are kept in a JavaScript `number`. The largest value a
 * `Decimal(12, 2)` column can hold is `9_999_999_999.99`, i.e.
 * `999_999_999_999` minor units, which is well within
 * {@link Number.MAX_SAFE_INTEGER} (~9.0e15), so integer arithmetic stays exact.
 */
export const MONEY_DECIMAL_PLACES = 2;

/** Scale factor between major units and minor units (10 ** decimal places). */
const SCALE = 10 ** MONEY_DECIMAL_PLACES;

/** Matches a 3-letter ISO-4217-style currency code (e.g. `ARS`, `USD`). */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Matches an optionally-signed decimal string with at most 2 fraction digits handled by the parser. */
const DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/**
 * Raised when an arithmetic operation is attempted on two {@link Money} values
 * of different currencies, which has no well-defined result without a
 * conversion rate.
 *
 * Lives in the shared kernel alongside {@link Money}. The Products module
 * re-exports it from `product-errors` to preserve its historical public API.
 */
export class CurrencyMismatchError extends BusinessRuleError {
  constructor(expected: string, actual: string) {
    super(`Cannot operate on Money of different currencies: "${expected}" vs "${actual}"`, {
      expected,
      actual,
    });
  }
}

/** Internal attributes of a {@link Money} value. */
interface MoneyProps {
  /** Integer amount in minor units (e.g. cents). May be negative. */
  amountMinor: number;
  /** Upper-cased 3-letter currency code. */
  currency: string;
}

/**
 * Immutable monetary value object.
 *
 * Holds an integer amount of minor units plus a currency code (see
 * {@link MONEY_DECIMAL_PLACES} for the representation rationale). Arithmetic
 * across different currencies is rejected with a {@link CurrencyMismatchError}
 * so callers cannot accidentally add ARS to USD. The value object is
 * domain-pure: it has no dependency on Prisma or any persistence concern.
 */
export class Money extends ValueObject<MoneyProps> {
  private constructor(props: MoneyProps) {
    super(props);
  }

  /**
   * Creates {@link Money} directly from an integer amount of minor units.
   *
   * @throws {ValidationError} when `amountMinor` is not a safe integer or the
   *   currency code is not a 3-letter string.
   */
  static fromMinorUnits(amountMinor: number, currency: string): Money {
    if (!Number.isSafeInteger(amountMinor)) {
      throw new ValidationError('Money amount (minor units) must be a safe integer', {
        amountMinor,
      });
    }
    return new Money({ amountMinor, currency: Money.normalizeCurrency(currency) });
  }

  /**
   * Creates {@link Money} from a decimal major amount expressed as a `number`
   * or a `string` (e.g. `12.5` or `"12.50"`).
   *
   * String inputs are parsed digit-by-digit so no floating-point rounding is
   * introduced. Numeric inputs are scaled and rounded to the nearest minor
   * unit. Fractional digits beyond {@link MONEY_DECIMAL_PLACES} are rounded
   * half-up.
   *
   * @throws {ValidationError} when the value is not a finite, parseable decimal.
   */
  static fromDecimal(value: number | string, currency: string): Money {
    const amountMinor =
      typeof value === 'number'
        ? Money.minorFromNumber(value)
        : Money.minorFromString(value);
    return Money.fromMinorUnits(amountMinor, currency);
  }

  /** Convenience factory for a zero amount in the given currency. */
  static zero(currency: string): Money {
    return new Money({ amountMinor: 0, currency: Money.normalizeCurrency(currency) });
  }

  private static normalizeCurrency(currency: string): string {
    if (typeof currency !== 'string') {
      throw new ValidationError('Currency code is required', { currency });
    }
    const normalized = currency.trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(normalized)) {
      throw new ValidationError('Currency must be a 3-letter ISO code', { currency });
    }
    return normalized;
  }

  private static minorFromNumber(value: number): number {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Money amount must be a finite number', { value });
    }
    // Round to the nearest minor unit to absorb floating-point representation
    // error (e.g. 0.1 * 100 === 10.000000000000002).
    return Math.round(value * SCALE);
  }

  private static minorFromString(value: string): number {
    const trimmed = value.trim();
    if (!DECIMAL_PATTERN.test(trimmed)) {
      throw new ValidationError('Money amount must be a valid decimal string', { value });
    }

    const negative = trimmed.startsWith('-');
    const unsigned = trimmed.replace(/^[+-]/, '');
    const [intPart = '0', fracPartRaw = ''] = unsigned.split('.');

    // Pad/round the fractional part to exactly MONEY_DECIMAL_PLACES digits.
    const fracPadded = fracPartRaw.padEnd(MONEY_DECIMAL_PLACES + 1, '0');
    const keptFrac = fracPadded.slice(0, MONEY_DECIMAL_PLACES);
    const roundingDigit = fracPadded.charAt(MONEY_DECIMAL_PLACES);

    let minor = Number(intPart) * SCALE + Number(keptFrac);
    if (Number(roundingDigit) >= 5) {
      minor += 1;
    }

    if (!Number.isSafeInteger(minor)) {
      throw new ValidationError('Money amount is too large to represent precisely', { value });
    }

    return negative ? -minor : minor;
  }

  /** The raw integer amount in minor units (e.g. cents). */
  get amountMinor(): number {
    return this.props.amountMinor;
  }

  /** The amount as a major-unit `number` (e.g. `12.5`). For display/serialisation. */
  get amount(): number {
    return this.props.amountMinor / SCALE;
  }

  /** The upper-cased 3-letter currency code. */
  get currency(): string {
    return this.props.currency;
  }

  /** Returns `true` when the amount is exactly zero. */
  isZero(): boolean {
    return this.props.amountMinor === 0;
  }

  /** Returns `true` when the amount is strictly greater than zero. */
  isPositive(): boolean {
    return this.props.amountMinor > 0;
  }

  /** Returns `true` when the amount is strictly less than zero. */
  isNegative(): boolean {
    return this.props.amountMinor < 0;
  }

  /**
   * Returns a new {@link Money} equal to this plus `other`.
   *
   * @throws {CurrencyMismatchError} when the currencies differ.
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinorUnits(this.props.amountMinor + other.props.amountMinor, this.props.currency);
  }

  /**
   * Returns a new {@link Money} equal to this minus `other`.
   *
   * @throws {CurrencyMismatchError} when the currencies differ.
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinorUnits(this.props.amountMinor - other.props.amountMinor, this.props.currency);
  }

  /**
   * Returns a new {@link Money} scaled by `factor` (e.g. a quantity), rounded
   * half-up to the nearest minor unit.
   *
   * @throws {ValidationError} when `factor` is not finite.
   */
  multiply(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new ValidationError('Money multiplier must be a finite number', { factor });
    }
    return Money.fromMinorUnits(Math.round(this.props.amountMinor * factor), this.props.currency);
  }

  /**
   * Compares two amounts of the same currency.
   *
   * @returns a negative number when this is less than `other`, `0` when equal,
   *   and a positive number when this is greater.
   * @throws {CurrencyMismatchError} when the currencies differ.
   */
  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.props.amountMinor - other.props.amountMinor;
  }

  /** Returns `true` when this amount is strictly greater than `other`. */
  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  /** Returns `true` when this amount is strictly less than `other`. */
  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  /** Returns the canonical decimal string form (e.g. `"12.50"`). */
  toDecimalString(): string {
    const negative = this.props.amountMinor < 0;
    const absMinor = Math.abs(this.props.amountMinor);
    const intPart = Math.trunc(absMinor / SCALE);
    const fracPart = (absMinor % SCALE).toString().padStart(MONEY_DECIMAL_PLACES, '0');
    return `${negative ? '-' : ''}${intPart}.${fracPart}`;
  }

  /** Stable `"AMOUNT CURRENCY"` string form (e.g. `"12.50 ARS"`). */
  override toString(): string {
    return `${this.toDecimalString()} ${this.props.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.props.currency !== other.props.currency) {
      throw new CurrencyMismatchError(this.props.currency, other.props.currency);
    }
  }
}
