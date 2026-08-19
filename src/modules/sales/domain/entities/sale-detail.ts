import { Entity } from '@domain/entities/entity.js';
import { ValidationError } from '@domain/errors/index.js';
import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import { InvalidSaleQuantityError } from '../errors/sale-errors.js';

/** Inclusive bounds for a line tax rate, expressed as a percentage. */
export const MIN_LINE_TAX_RATE = 0;
export const MAX_LINE_TAX_RATE = 100;

/** Attributes describing a single sold line on a sale. */
export interface SaleDetailProps {
  productId: UUID;
  /** Units sold. A strictly positive integer. */
  quantity: number;
  /** Price of one unit, captured at sale time (Money, tax-exclusive). */
  unitPrice: Money;
  /** Tax rate as a percentage in the inclusive range `[0, 100]`. */
  taxRate: number;
}

/** Input accepted by {@link SaleDetail.create}. */
export interface CreateSaleDetailInput {
  productId: UUID;
  quantity: number;
  unitPrice: Money;
  taxRate?: number;
}

/**
 * A sale line item (Requirement 9.1).
 *
 * Captures the product, quantity and the unit price/tax rate *as of the moment
 * of sale* so historical documents stay accurate even if the catalogue price
 * later changes. All monetary figures are derived on demand from {@link Money}
 * integer arithmetic, so there is no float drift and the persisted
 * `subtotal`/`taxAmount`/`total` columns always reconcile:
 *
 * - `subtotal`  = `unitPrice * quantity`
 * - `taxAmount` = `subtotal * taxRate / 100` (rounded half-up to the minor unit)
 * - `total`     = `subtotal + taxAmount`
 */
export class SaleDetail extends Entity<SaleDetailProps> {
  private constructor(props: SaleDetailProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Creates a validated line item.
   *
   * @throws {InvalidSaleQuantityError} when `quantity` is not a positive integer.
   * @throws {ValidationError} when the tax rate is out of range.
   */
  static create(input: CreateSaleDetailInput, id?: UUID): SaleDetail {
    const quantity = SaleDetail.assertQuantity(input.quantity);
    const taxRate = SaleDetail.assertTaxRate(input.taxRate ?? 0);
    return new SaleDetail(
      {
        productId: input.productId,
        quantity,
        unitPrice: input.unitPrice,
        taxRate,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link SaleDetail} from already-validated persisted state.
   * Trusts the data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: SaleDetailProps): SaleDetail {
    return new SaleDetail({ ...props }, id);
  }

  get productId(): UUID {
    return this.props.productId;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get unitPrice(): Money {
    return this.props.unitPrice;
  }

  get taxRate(): number {
    return this.props.taxRate;
  }

  /** The tax-exclusive line amount: `unitPrice * quantity`. */
  get subtotal(): Money {
    return this.props.unitPrice.multiply(this.props.quantity);
  }

  /** The tax portion of the line: `subtotal * taxRate / 100`. */
  get taxAmount(): Money {
    return this.subtotal.multiply(this.props.taxRate / 100);
  }

  /** The tax-inclusive line amount: `subtotal + taxAmount`. */
  get total(): Money {
    return this.subtotal.add(this.taxAmount);
  }

  private static assertQuantity(quantity: number): number {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidSaleQuantityError(quantity);
    }
    return quantity;
  }

  private static assertTaxRate(taxRate: number): number {
    if (!Number.isFinite(taxRate) || taxRate < MIN_LINE_TAX_RATE || taxRate > MAX_LINE_TAX_RATE) {
      throw new ValidationError(
        `Tax rate must be between ${MIN_LINE_TAX_RATE} and ${MAX_LINE_TAX_RATE}`,
        { taxRate },
      );
    }
    return taxRate;
  }
}
