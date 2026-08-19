import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenCashRegisterUseCase } from './open-cash-register.use-case.js';
import type { Cash } from '../../domain/entities/cash.js';
import type { CashMovement } from '../../domain/entities/cash-movement.js';
import type { ICashRepository } from '../../domain/repositories/cash-repository.js';
import type { ICashMovementRepository } from '../../domain/repositories/cash-movement-repository.js';
import type {
  CashTransactionContext,
  ICashUnitOfWork,
} from '../../domain/repositories/cash-unit-of-work.js';

class FakeCashRepository implements Partial<ICashRepository> {
  public created: Cash | null = null;
  create = vi.fn(async (cash: Cash): Promise<Cash> => {
    this.created = cash;
    return cash;
  });
}

class FakeMovementRepository implements Partial<ICashMovementRepository> {
  public created: CashMovement | null = null;
  create = vi.fn(async (movement: CashMovement): Promise<CashMovement> => {
    this.created = movement;
    return movement;
  });
}

describe('OpenCashRegisterUseCase', () => {
  let cashRepo: FakeCashRepository;
  let movementRepo: FakeMovementRepository;
  let executeSpy: ReturnType<typeof vi.fn>;
  let unitOfWork: ICashUnitOfWork;
  let useCase: OpenCashRegisterUseCase;

  beforeEach(() => {
    cashRepo = new FakeCashRepository();
    movementRepo = new FakeMovementRepository();
    executeSpy = vi.fn((work: (ctx: CashTransactionContext) => Promise<unknown>) =>
      work({
        cash: cashRepo as unknown as ICashRepository,
        movements: movementRepo as unknown as ICashMovementRepository,
        payments: {} as unknown as CashTransactionContext['payments'],
      }),
    );
    unitOfWork = { execute: executeSpy } as unknown as ICashUnitOfWork;
    useCase = new OpenCashRegisterUseCase(unitOfWork);
  });

  it('opens a register with an opening float and books an opening movement atomically', async () => {
    const output = await useCase.execute({
      tenantId: 't1',
      userId: 'u1',
      name: 'Main',
      openingBalance: '100.00',
    });

    expect(executeSpy).toHaveBeenCalledOnce();
    expect(cashRepo.create).toHaveBeenCalledOnce();
    expect(movementRepo.create).toHaveBeenCalledOnce();

    // The opening movement is an INCOME categorised as 'opening'.
    expect(movementRepo.created?.type).toBe('INCOME');
    expect(movementRepo.created?.category).toBe('opening');
    expect(movementRepo.created?.amount.toDecimalString()).toBe('100.00');
    expect(movementRepo.created?.cashId).toBe(output.id);

    // The stored balance reconciles with the opening movement.
    expect(output.balance).toBe('100.00');
    expect(output.currency).toBe('ARS');
    expect(output.name).toBe('Main');
  });

  it('opens a register with a zero balance and no movement when no float is given', async () => {
    const output = await useCase.execute({ tenantId: 't1', userId: 'u1', name: 'Backup' });

    expect(cashRepo.create).toHaveBeenCalledOnce();
    expect(movementRepo.create).not.toHaveBeenCalled();
    expect(output.balance).toBe('0.00');
  });

  it('honours an explicit currency and branch', async () => {
    const output = await useCase.execute({
      tenantId: 't1',
      userId: 'u1',
      name: 'USD Drawer',
      branchId: 'b1',
      openingBalance: 50,
      currency: 'USD',
    });
    expect(output.currency).toBe('USD');
    expect(output.branchId).toBe('b1');
    expect(output.balance).toBe('50.00');
    expect(movementRepo.created?.amount.currency).toBe('USD');
  });
});
