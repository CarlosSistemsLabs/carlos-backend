import { Entity } from '@domain/entities/entity.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import {
  assertStockMovementType,
  type StockMovementType,
} from '../value-objects/stock-movement-type.js';

/** Attributes of a single, immutable stock-movement audit record. */
export interface StockMovementProps {
  tenantId: UUID;
  productId: UUID;
  /** The branch affected; `null` for tenant-wide movements. */
  branchId: Nullable<UUID>;
  type: StockMovementType;
  /** The (always positive) number of units moved. */
  quantity: number;
  /** Optional link to the originating document (sale id, purchase id, ...). */
  reference: Nullable<string>;
  notes: Nullable<string>;
  createdAt: Date;
}

/** Input accepted by {@link StockMovement.create}. */
export interface CreateStockMovementInput {
  tenantId: UUID;
  productId: UUID;
  branchId?: Nullable<UUID>;
  type: StockMovementType | string;
  quantity: number;
  reference?: Nullable<string>;
  notes?: Nullable<string>;
  /** Defaults to the current time when omitted. */
  createdAt?: Date;
}

/**
 * StockMovement entity (Requirement 9.1).
 *
 * An **immutable** audit-trail record of a single change to inventory. Once
 * created it is never mutated — corrections are made by recording further
 * movements — so the entity exposes getters only. Every movement carries a
 * strictly positive {@link quantity}; the {@link type} conveys the direction
 * (see `stock-movement-type.ts` for the sign conventions).
 */
export class StockMovement extends Entity<StockMovementProps> {
  private constructor(props: StockMovementProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Records a new movement, validating the type and quantity.
   *
   * @throws {ValidationError} when `type` is invalid or `quantity` is not a
   *   positive integer.
   */
  static create(input: CreateStockMovementInput, id?: UUID): StockMovement {
    const type = assertStockMovementType(input.type);
    const quantity = StockMovement.assertQuantity(input.quantity);
    return new StockMovement(
      {
        tenantId: input.tenantId,
        productId: input.productId,
        branchId: input.branchId ?? null,
        type,
        quantity,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        createdAt: input.createdAt ?? new Date(),
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link StockMovement} from already-validated persisted state.
   */
  static reconstitute(id: UUID, props: StockMovementProps): StockMovement {
    return new StockMovement({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get productId(): UUID {
    return this.props.productId;
  }

  get branchId(): Nullable<UUID> {
    return this.props.branchId;
  }

  get type(): StockMovementType {
    return this.props.type;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get reference(): Nullable<string> {
    return this.props.reference;
  }

  get notes(): Nullable<string> {
    return this.props.notes;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  private static assertQuantity(quantity: number): number {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Stock movement quantity must be a positive integer', {
        quantity,
      });
    }
    return quantity;
  }
}
