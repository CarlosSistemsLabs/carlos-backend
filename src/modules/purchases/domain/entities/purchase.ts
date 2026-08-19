import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { BusinessRuleError, ValidationError } from '@domain/errors/index.js';
import { PurchaseCompletedEvent } from '@domain/events/index.js';
import type { StockAffectingItem } from '@domain/events/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { PurchaseDetail } from './purchase-detail.js';
import { assertTransition, type PurchaseStatus } from '../value-objects/purchase-status.js';
import { EmptyPurchaseError } from '../errors/purchase-errors.js';

/** The aggregate-computed monetary totals of a purchase. */
export interface PurchaseTotals {
  subtotal: Money;
  taxAmount: Money;
  total: Money;
}

/** Attributes describing a purchase document. */
export interface PurchaseProps {
  tenantId: UUID;
  supplierId: UUID;
  userId: UUID;
  purchaseNumber: string;
  purchaseDate: Date;
  status: PurchaseStatus;
  items: PurchaseDetail[];
  notes: Nullable<string>;
  /** ISO currency all line/total money amounts are denominated in. */
  currency: string;
}

/** Input accepted by {@link Purchase.create} when opening a new (draft) purchase. */
export interface CreatePurchaseInput {
  tenantId: UUID;
  supplierId: UUID;
  userId: UUID;
  purchaseNumber: string;
  currency: string;
  purchaseDate?: Date;
  notes?: Nullable<string>;
  items?: PurchaseDetail[];
}

/**
 * Purchase aggregate root (Requirement 9.1, 10.3).
 *
 * Mirrors the Sales module's `Sale` aggregate but records goods **coming in**
 * from a supplier rather than going out to a customer. It owns its line items
 * ({@link PurchaseDetail}) and is the single entry point for mutating them, so
 * the monetary totals always reconcile with the lines. A new purchase is born
 * as a `draft`; {@link complete} finalises it (guarding the state transition and
 * the non-empty invariant) and **buffers a `PurchaseCompleted` domain event**.
 * Actual publication of that event — and the resulting stock **increment** — is
 * wired in task 21.2; here the event is only recorded on the aggregate for the
 * application layer to pull.
 *
 * **No branch dimension:** unlike `Sale`, the `Purchase` table has no
 * `branchId` column, so the stock-affecting items carry `branchId: null` (the
 * movement targets the tenant-wide balance).
 *
 * **Totals are derived, never stored on the aggregate:** {@link subtotal},
 * {@link taxAmount} and {@link total} are computed from the lines using
 * {@link Money} integer math (no float drift). The persisted
 * `subtotal`/`taxAmount`/`total` columns are written from these getters.
 *
 * **Purchase-number uniqueness** (`@@unique([tenantId, purchaseNumber])`) spans
 * multiple aggregates, so it is generated + enforced at the
 * repository/use-case level (see `nextPurchaseNumber`); the entity treats
 * {@link purchaseNumber} as an opaque, already-assigned identifier.
 */
export class Purchase extends AggregateRoot<PurchaseProps> {
  private constructor(props: PurchaseProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Opens a new purchase in `draft` status.
   *
   * @throws {ValidationError} when a required identifier or the purchase number
   *   is missing, or when a supplied line's currency differs from the purchase's.
   */
  static create(input: CreatePurchaseInput, id?: UUID): Purchase {
    const purchaseNumber = Purchase.assertPurchaseNumber(input.purchaseNumber);
    const currency = Money.zero(input.currency).currency; // validates + normalises
    const purchase = new Purchase(
      {
        tenantId: input.tenantId,
        supplierId: input.supplierId,
        userId: input.userId,
        purchaseNumber,
        purchaseDate: input.purchaseDate ?? new Date(),
        status: 'draft',
        items: [],
        notes: input.notes ?? null,
        currency,
      },
      id,
    );
    for (const item of input.items ?? []) {
      purchase.addLineItem(item);
    }
    return purchase;
  }

  /**
   * Rehydrates a {@link Purchase} from already-validated persisted state. Trusts
   * the data store and performs no re-validation (including status).
   */
  static reconstitute(id: UUID, props: PurchaseProps): Purchase {
    return new Purchase({ ...props, items: [...props.items] }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get supplierId(): UUID {
    return this.props.supplierId;
  }

  get userId(): UUID {
    return this.props.userId;
  }

  get purchaseNumber(): string {
    return this.props.purchaseNumber;
  }

  get purchaseDate(): Date {
    return this.props.purchaseDate;
  }

  get status(): PurchaseStatus {
    return this.props.status;
  }

  get notes(): Nullable<string> {
    return this.props.notes;
  }

  get currency(): string {
    return this.props.currency;
  }

  /** The line items, as a read-only view. */
  get items(): readonly PurchaseDetail[] {
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
   * Appends a line item. Only permitted while the purchase is a `draft` — a
   * finalised or cancelled purchase is immutable.
   *
   * @throws {BusinessRuleError} when the purchase is not a draft.
   * @throws {ValidationError} when the line currency differs from the purchase's.
   */
  addLineItem(detail: PurchaseDetail): void {
    if (this.props.status !== 'draft') {
      throw new BusinessRuleError('Cannot modify the lines of a non-draft purchase', {
        status: this.props.status,
      });
    }
    if (detail.unitCost.currency !== this.props.currency) {
      throw new ValidationError('Purchase line currency must match the purchase currency', {
        purchaseCurrency: this.props.currency,
        lineCurrency: detail.unitCost.currency,
      });
    }
    this.props.items.push(detail);
  }

  /**
   * Recomputes and returns the monetary totals from the current line items
   * using {@link Money} integer arithmetic. Pure (no mutation); callers may use
   * it to project the persisted `subtotal`/`taxAmount`/`total` columns.
   */
  recalculateTotals(): PurchaseTotals {
    let subtotal = Money.zero(this.props.currency);
    let taxAmount = Money.zero(this.props.currency);
    for (const item of this.props.items) {
      subtotal = subtotal.add(item.subtotal);
      taxAmount = taxAmount.add(item.taxAmount);
    }
    return { subtotal, taxAmount, total: subtotal.add(taxAmount) };
  }

  /**
   * Finalises a draft purchase (`draft → completed`) and buffers a
   * {@link PurchaseCompletedEvent} for the application layer to publish (task
   * 21.2 subscribes the Stock module to **increment** inventory).
   *
   * @throws {EmptyPurchaseError} when the purchase has no line items.
   * @throws {InvalidPurchaseStatusTransitionError} when the purchase is not a draft.
   */
  complete(): void {
    assertTransition(this.props.status, 'completed');
    if (this.props.items.length === 0) {
      throw new EmptyPurchaseError();
    }
    this.props.status = 'completed';
    this.addDomainEvent(
      new PurchaseCompletedEvent({
        tenantId: this.props.tenantId,
        purchaseId: this.id,
        items: this.toStockAffectingItems(),
      }),
    );
  }

  /**
   * Voids the purchase (`draft → cancelled` or `completed → cancelled`).
   *
   * @throws {InvalidPurchaseStatusTransitionError} when the purchase is already cancelled.
   */
  cancel(): void {
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled';
  }

  /**
   * Maps the lines to the stock-affecting shape carried by the integration
   * event. A purchase has no branch, so `branchId` is `null` for every item.
   */
  private toStockAffectingItems(): StockAffectingItem[] {
    return this.props.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      branchId: null,
    }));
  }

  private static assertPurchaseNumber(purchaseNumber: string): string {
    if (typeof purchaseNumber !== 'string' || purchaseNumber.trim().length === 0) {
      throw new ValidationError('Purchase number is required', { purchaseNumber });
    }
    return purchaseNumber.trim();
  }
}
