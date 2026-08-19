import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PurchaseCompletedEvent,
  SaleCompletedEvent,
} from '@domain/events/index.js';
import { InMemoryEventBus } from '@infrastructure/events/in-memory-event-bus.js';
import { StockEventHandlers, type StockEventLogger } from './stock-event-handlers.js';
import { InsufficientStockError } from '../../domain/errors/stock-errors.js';
import type { RecordStockMovementUseCase } from '../use-cases/record-stock-movement.use-case.js';

function makeRecorder(): { recorder: RecordStockMovementUseCase; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ stocks: [], movements: [] }));
  return { recorder: { execute } as unknown as RecordStockMovementUseCase, execute };
}

function makeLogger(): StockEventLogger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { warn: vi.fn(), error: vi.fn() };
}

describe('StockEventHandlers', () => {
  let execute: ReturnType<typeof vi.fn>;
  let recorder: RecordStockMovementUseCase;
  let logger: ReturnType<typeof makeLogger>;
  let handlers: StockEventHandlers;

  beforeEach(() => {
    ({ recorder, execute } = makeRecorder());
    logger = makeLogger();
    handlers = new StockEventHandlers(recorder, logger);
  });

  describe('onSaleCompleted', () => {
    it('records an OUT movement per item referenced sale:<saleId>', async () => {
      await handlers.onSaleCompleted(
        new SaleCompletedEvent({
          tenantId: 'tenant-1',
          saleId: 'sale-7',
          items: [
            { productId: 'p-1', quantity: 2, branchId: 'b-1' },
            { productId: 'p-2', quantity: 5 },
          ],
        }),
      );

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenNthCalledWith(1, {
        tenantId: 'tenant-1',
        productId: 'p-1',
        branchId: 'b-1',
        type: 'OUT',
        quantity: 2,
        reference: 'sale:sale-7',
      });
      expect(execute).toHaveBeenNthCalledWith(2, {
        tenantId: 'tenant-1',
        productId: 'p-2',
        branchId: null,
        type: 'OUT',
        quantity: 5,
        reference: 'sale:sale-7',
      });
    });

    it('logs and continues when an item has insufficient stock (does not throw)', async () => {
      execute
        .mockRejectedValueOnce(new InsufficientStockError(1, 3))
        .mockResolvedValueOnce({ stocks: [], movements: [] });

      await expect(
        handlers.onSaleCompleted(
          new SaleCompletedEvent({
            tenantId: 'tenant-1',
            saleId: 'sale-8',
            items: [
              { productId: 'p-1', quantity: 3 },
              { productId: 'p-2', quantity: 1 },
            ],
          }),
        ),
      ).resolves.toBeUndefined();

      // Both items attempted; the second still processed after the first failed.
      expect(execute).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        saleId: 'sale-8',
        productId: 'p-1',
        requested: 3,
      });
    });

    it('propagates unexpected (non-insufficient-stock) errors', async () => {
      execute.mockRejectedValueOnce(new Error('db down'));

      await expect(
        handlers.onSaleCompleted(
          new SaleCompletedEvent({
            tenantId: 'tenant-1',
            saleId: 'sale-9',
            items: [{ productId: 'p-1', quantity: 1 }],
          }),
        ),
      ).rejects.toThrow('db down');
    });
  });

  describe('onPurchaseCompleted', () => {
    it('records an IN movement per item referenced purchase:<purchaseId>', async () => {
      await handlers.onPurchaseCompleted(
        new PurchaseCompletedEvent({
          tenantId: 'tenant-1',
          purchaseId: 'po-3',
          items: [{ productId: 'p-1', quantity: 10, branchId: 'b-2' }],
        }),
      );

      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        productId: 'p-1',
        branchId: 'b-2',
        type: 'IN',
        quantity: 10,
        reference: 'purchase:po-3',
      });
    });
  });

  describe('register', () => {
    it('subscribes to sale and purchase events on the bus', async () => {
      const bus = new InMemoryEventBus();
      handlers.register(bus);

      await bus.publish(
        new SaleCompletedEvent({
          tenantId: 'tenant-1',
          saleId: 'sale-1',
          items: [{ productId: 'p-1', quantity: 1 }],
        }),
      );
      await bus.publish(
        new PurchaseCompletedEvent({
          tenantId: 'tenant-1',
          purchaseId: 'po-1',
          items: [{ productId: 'p-1', quantity: 1 }],
        }),
      );

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[0]?.[0]).toMatchObject({ type: 'OUT', reference: 'sale:sale-1' });
      expect(execute.mock.calls[1]?.[0]).toMatchObject({ type: 'IN', reference: 'purchase:po-1' });
    });

    it('returns a disposer that removes the subscriptions', async () => {
      const bus = new InMemoryEventBus();
      const dispose = handlers.register(bus);
      dispose();

      await bus.publish(
        new SaleCompletedEvent({
          tenantId: 'tenant-1',
          saleId: 'sale-1',
          items: [{ productId: 'p-1', quantity: 1 }],
        }),
      );

      expect(execute).not.toHaveBeenCalled();
    });
  });
});
