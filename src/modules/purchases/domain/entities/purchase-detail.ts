import { Entity } from '@domain/entities/entity.js';
import { ValidationError } from '@domain/errors/index.js';
import type { UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import { InvalidPurchaseQuantityError } from '../errors/purchase-errors.js';

/** Inclusive bounds for a line tax rate, expressed as a percentage. */
export const MIN_LINE_TAX_RATE = 0;
export const MAX_LINE_TAX_RATE = 100;

/** Attributes describing a single purchased line on a purchase. */
export interface PurchaseDetailProps {
  productId: UUID;
  /** Units purchased. A strictly positive integer. */
  quantity: number;
  /** Cost of one unit, captured at purchase time (Money, tax-exclusive). */
  unitCost: Money;
  /** Tax rate as a percentage in the inclusive range `[0, 100]`. */
  taxRate: number;
}

/** Input accepted by {@link PurchaseDetail.create}. */
export interface CreatePurchaseDetailInput {
  productId: UUID;
  quantity: number;
  unitCost: Money;
  taxRate?: number;
}

/**
 * A purchase line item (Requirement 9.1).
 *
 * Captures the product, quantity and the unit cost/tax rate *as of the moment
 * of purchase* so historical documents stay accurate even if the catalogue cost
 * later changes. Mirrors the Sales module's `SaleDetail` but the captured price
 * is the **unit cost** (what the tenant pays the supplier), not a sale price.
 * All monetary figures are derived on demand from {@link Money} integer
 * arithmetic, so there is no float drift and the persisted
 * `subtotal`/`taxAmount`/`total` columns always reconcile:
 *
 * - `subtotal`  = `unitCost * quantity`
 * - `taxAmount` = `subtotal * taxRate / 100` (rounded half-up to the minor unit)
 * - `total`     = `subtotal + taxAmount`
 */
export class PurchaseDetail extends Entity<PurchaseDetailProps> {
  private constructor(props: PurchaseDetailProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Creates a validated line item.
   *
   * @throws {InvalidPurchaseQuantityError} when `quantity` is not a positive integer.
   * @throws {ValidationError} when the tax rate is out of range.
   */
  static create(input: CreatePurchaseDetailInput, id?: UUID): PurchaseDetail {
    const quantity = PurchaseDetail.assertQuantity(input.quantity);
    const taxRate = PurchaseDetail.assertTaxRate(input.taxRate ?? 0);
    return new PurchaseDetail(
      {
        productId: input.productId,
        quantity,
        unitCost: input.unitCost,
        taxRate,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link PurchaseDetail} from already-validated persisted state.
   * Trusts the data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: PurchaseDetailProps): PurchaseDetail {
    return new PurchaseDetail({ ...props }, id);
  }

  get productId(): UUID {
    return this.props.productId;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get unitCost(): Money {
    return this.props.unitCost;
  }

  get taxRate(): number {
    return this.props.taxRate;
  }

  /** The tax-exclusive line amount: `unitCost * quantity`. */
  get subtotal(): Money {
    return this.props.unitCost.multiply(this.props.quantity);
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
      throw new InvalidPurchaseQuantityError(quantity);
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
