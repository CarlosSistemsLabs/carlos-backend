import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';
import { SaleCompletedEvent, type StockAffectingItem } from '@domain/events/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { SaleDetail } from './sale-detail.js';
import {
  assertTransition,
  type SaleStatus,
} from '../value-objects/sale-status.js';
import { EmptySaleError } from '../errors/sale-errors.js';

/** The aggregate-computed monetary totals of a sale. */
export interface SaleTotals {
  subtotal: Money;
  taxAmount: Money;
  total: Money;
}

/** Attributes describing a sale document. */
export interface SaleProps {
  tenantId: UUID;
  customerId: UUID;
  branchId: Nullable<UUID>;
  userId: UUID;
  saleNumber: string;
  saleDate: Date;
  status: SaleStatus;
  items: SaleDetail[];
  notes: Nullable<string>;
  /** ISO currency all line/total money amounts are denominated in. */
  currency: string;
}

/** Input accepted by {@link Sale.create} when opening a new (draft) sale. */
export interface CreateSaleInput {
  tenantId: UUID;
  customerId: UUID;
  userId: UUID;
  saleNumber: string;
  currency: string;
  branchId?: Nullable<UUID>;
  saleDate?: Date;
  notes?: Nullable<string>;
  items?: SaleDetail[];
}

/**
 * Sale aggregate root (Requirement 9.1).
 *
 * Owns its line items ({@link SaleDetail}) and is the single entry point for
 * mutating them, so the monetary totals always reconcile with the lines. A new
 * sale is born as a `draft`; {@link complete} finalises it (guarding the state
 * transition and the non-empty invariant) and **buffers a `SaleCompleted`
 * domain event**. Actual publication of that event — and the resulting stock
 * decrement — is wired in task 19.2; here the event is only recorded on the
 * aggregate for the application layer to pull.
 *
 * **Totals are derived, never stored on the aggregate:** {@link subtotal},
 * {@link taxAmount} and {@link total} are computed from the lines using
 * {@link Money} integer math (no float drift). The persisted
 * `subtotal`/`taxAmount`/`total` columns are written from these getters.
 *
 * **Sale-number uniqueness** (`@@unique([tenantId, saleNumber])`) spans multiple
 * aggregates, so it is generated + enforced at the repository/use-case level
 * (see `nextSaleNumber`); the entity treats {@link saleNumber} as an opaque,
 * already-assigned identifier.
 */
export class Sale extends AggregateRoot<SaleProps> {
  private constructor(props: SaleProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Opens a new sale in `draft` status.
   *
   * @throws {ValidationError} when a required identifier or the sale number is
   *   missing, or when a supplied line's currency differs from the sale's.
   */
  static create(input: CreateSaleInput, id?: UUID): Sale {
    const saleNumber = Sale.assertSaleNumber(input.saleNumber);
    const currency = Money.zero(input.currency).currency; // validates + normalises
    const sale = new Sale(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        branchId: input.branchId ?? null,
        userId: input.userId,
        saleNumber,
        saleDate: input.saleDate ?? new Date(),
        status: 'draft',
        items: [],
        notes: input.notes ?? null,
        currency,
      },
      id,
    );
    for (const item of input.items ?? []) {
      sale.addLineItem(item);
    }
    return sale;
  }

  /**
   * Rehydrates a {@link Sale} from already-validated persisted state. Trusts the
   * data store and performs no re-validation (including status).
   */
  static reconstitute(id: UUID, props: SaleProps): Sale {
    return new Sale({ ...props, items: [...props.items] }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get customerId(): UUID {
    return this.props.customerId;
  }

  get branchId(): Nullable<UUID> {
    return this.props.branchId;
  }

  get userId(): UUID {
    return this.props.userId;
  }

  get saleNumber(): string {
    return this.props.saleNumber;
  }

  get saleDate(): Date {
    return this.props.saleDate;
  }

  get status(): SaleStatus {
    return this.props.status;
  }

  get notes(): Nullable<string> {
    return this.props.notes;
  }

  get currency(): string {
    return this.props.currency;
  }

  /** The line items, as a read-only view. */
  get items(): readonly SaleDetail[] {
    return this.props.items;
  }

  /** The tax-exclusive sum of every line subtotal. */
  get subtotal(): Money {
    return this.recalculateTotals().subtotal;
  }

  /** The sum of every line's tax amount. */
  get taxAmount(): Money {
    return this.recalculateTotals().taxAmount;
  }

  /** The tax-inclusive grand total (`subtotal + taxAmount`). */
  get total(): Money {
    return this.recalculateTotals().total;
  }

  /**
   * Appends a line item. Only permitted while the sale is a `draft` — a
   * finalised or cancelled sale is immutable.
   *
   * @throws {BusinessRuleError} when the sale is not a draft.
   * @throws {ValidationError} when the line currency differs from the sale's.
   */
  addLineItem(detail: SaleDetail): void {
    if (this.props.status !== 'draft') {
      throw new BusinessRuleError('Cannot modify the lines of a non-draft sale', {
        status: this.props.status,
      });
    }
    if (detail.unitPrice.currency !== this.props.currency) {
      throw new ValidationError('Sale line currency must match the sale currency', {
        saleCurrency: this.props.currency,
        lineCurrency: detail.unitPrice.currency,
      });
    }
    this.props.items.push(detail);
  }

  /**
   * Recomputes and returns the monetary totals from the current line items
   * using {@link Money} integer arithmetic. Pure (no mutation); callers may use
   * it to project the persisted `subtotal`/`taxAmount`/`total` columns.
   */
  recalculateTotals(): SaleTotals {
    let subtotal = Money.zero(this.props.currency);
    let taxAmount = Money.zero(this.props.currency);
    for (const item of this.props.items) {
      subtotal = subtotal.add(item.subtotal);
      taxAmount = taxAmount.add(item.taxAmount);
    }
    return { subtotal, taxAmount, total: subtotal.add(taxAmount) };
  }

  /**
   * Finalises a draft sale (`draft → completed`) and buffers a
   * {@link SaleCompletedEvent} for the application layer to publish (task 19.2
   * subscribes the Stock module to decrement inventory).
   *
   * @throws {EmptySaleError} when the sale has no line items.
   * @throws {InvalidSaleStatusTransitionError} when the sale is not a draft.
   */
  complete(): void {
    assertTransition(this.props.status, 'completed');
    if (this.props.items.length === 0) {
      throw new EmptySaleError();
    }
    this.props.status = 'completed';
    this.addDomainEvent(
      new SaleCompletedEvent({
        tenantId: this.props.tenantId,
        saleId: this.id,
        items: this.toStockAffectingItems(),
      }),
    );
  }

  /**
   * Voids the sale (`draft → cancelled` or `completed → cancelled`).
   *
   * @throws {InvalidSaleStatusTransitionError} when the sale is already cancelled.
   */
  cancel(): void {
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled';
  }

  /** Maps the lines to the stock-affecting shape carried by the integration event. */
  private toStockAffectingItems(): StockAffectingItem[] {
    return this.props.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      branchId: this.props.branchId,
    }));
  }

  private static assertSaleNumber(saleNumber: string): string {
    if (typeof saleNumber !== 'string' || saleNumber.trim().length === 0) {
      throw new ValidationError('Sale number is required', { saleNumber });
    }
    return saleNumber.trim();
  }
}
