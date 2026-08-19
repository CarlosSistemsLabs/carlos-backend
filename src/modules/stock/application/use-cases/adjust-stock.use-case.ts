import { Stock } from '../../domain/entities/stock.js';
import { StockMovement } from '../../domain/entities/stock-movement.js';
import { InvalidStockTransferError } from '../../domain/errors/stock-errors.js';
import { assertStockMovementType } from '../../domain/value-objects/stock-movement-type.js';
import type {
  IStockUnitOfWork,
  StockTransactionContext,
} from '../../domain/repositories/stock-unit-of-work.js';
import {
  toStockMovementOutput,
  toStockOutput,
  type AdjustStockInputDto,
  type AdjustStockOutput,
} from '../dto/stock-dtos.js';

/**
 * Adjusts a product's on-hand stock and records the movement (Requirement 9.1).
 *
 * The balance is loaded (or opened on first movement), the movement is applied
 * per its type's sign convention, the balance is persisted and a
 * {@link StockMovement} audit record is written — **all inside a single
 * transaction** (via {@link IStockUnitOfWork}) so the balance and its audit
 * trail can never diverge.
 *
 * Movement semantics:
 * - **IN** / **ADJUSTMENT** — increase the balance.
 * - **OUT** — decrease the balance, guarded so it cannot go negative
 *   (throws `InsufficientStockError`).
 * - **TRANSFER** — move units between two branches: decrease the source branch
 *   and increase the destination branch, opening the destination balance if it
 *   does not exist yet. Two movement rows are recorded (one per branch) so each
 *   leg is auditable; the destination requires a distinct `destinationBranchId`.
 *
 * This use case is the single write path for inventory, so the automatic
 * sale/purchase stock decrement (task 15.2) can drive it from event handlers.
 */
export class AdjustStockUseCase {
  constructor(private readonly uow: IStockUnitOfWork) {}

  async execute(input: AdjustStockInputDto): Promise<AdjustStockOutput> {
    const type = assertStockMovementType(input.type);
    const branchId = input.branchId ?? null;

    if (type === 'TRANSFER') {
      return this.executeTransfer(input, branchId);
    }

    return this.uow.execute(async (ctx) => {
      const stock = await this.loadOrOpen(ctx, input.tenantId, input.productId, branchId);
      stock.applyMovement(type, input.quantity);
      const savedStock = await ctx.stocks.save(stock);

      const movement = StockMovement.create({
        tenantId: input.tenantId,
        productId: input.productId,
        branchId,
        type,
        quantity: input.quantity,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      });
      const savedMovement = await ctx.movements.create(movement);

      return {
        stocks: [toStockOutput(savedStock)],
        movements: [toStockMovementOutput(savedMovement)],
      };
    });
  }

  private async executeTransfer(
    input: AdjustStockInputDto,
    sourceBranchId: string | null,
  ): Promise<AdjustStockOutput> {
    const destinationBranchId = input.destinationBranchId ?? null;
    if (destinationBranchId === null || destinationBranchId === sourceBranchId) {
      throw new InvalidStockTransferError();
    }

    return this.uow.execute(async (ctx) => {
      // Decrease the source branch first so an insufficient balance aborts the
      // whole transaction before any write is committed.
      const source = await this.loadOrOpen(ctx, input.tenantId, input.productId, sourceBranchId);
      source.decrease(input.quantity);
      const savedSource = await ctx.stocks.save(source);

      const destination = await this.loadOrOpen(
        ctx,
        input.tenantId,
        input.productId,
        destinationBranchId,
      );
      destination.increase(input.quantity);
      const savedDestination = await ctx.stocks.save(destination);

      const outbound = StockMovement.create({
        tenantId: input.tenantId,
        productId: input.productId,
        branchId: sourceBranchId,
        type: 'TRANSFER',
        quantity: input.quantity,
        reference: input.reference ?? null,
        notes: input.notes ?? `Transfer to branch ${destinationBranchId}`,
      });
      const inbound = StockMovement.create({
        tenantId: input.tenantId,
        productId: input.productId,
        branchId: destinationBranchId,
        type: 'TRANSFER',
        quantity: input.quantity,
        reference: input.reference ?? null,
        notes: input.notes ?? `Transfer from branch ${sourceBranchId ?? 'tenant-wide'}`,
      });
      const savedOutbound = await ctx.movements.create(outbound);
      const savedInbound = await ctx.movements.create(inbound);

      return {
        stocks: [toStockOutput(savedSource), toStockOutput(savedDestination)],
        movements: [toStockMovementOutput(savedOutbound), toStockMovementOutput(savedInbound)],
      };
    });
  }

  /** Loads an existing balance or opens a new (zero) one on first movement. */
  private async loadOrOpen(
    ctx: StockTransactionContext,
    tenantId: string,
    productId: string,
    branchId: string | null,
  ): Promise<Stock> {
    const existing = await ctx.stocks.findByProductBranch(tenantId, productId, branchId);
    if (existing !== null) {
      return existing;
    }
    return Stock.create({ tenantId, productId, branchId });
  }
}
