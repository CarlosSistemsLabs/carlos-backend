import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import { CloseCashRegisterUseCase } from './close-cash-register.use-case.js';
import { Cash } from '../../domain/entities/cash.js';
import type { CashMovement } from '../../domain/entities/cash-movement.js';
import type { ICashRepository } from '../../domain/repositories/cash-repository.js';
import type { ICashMovementRepository } from '../../domain/repositories/cash-movement-repository.js';
import type {
  CashTransactionContext,
  ICashUnitOfWork,
} from '../../domain/repositories/cash-unit-of-work.js';

class FakeCashRepository implements Partial<ICashRepository> {
  public register: Cash | null = null;
  public updatedBalance: string | null = null;

  findById = vi.fn(async (): Promise<Cash | null> => this.register);
  updateBalance = vi.fn(async (_id: string, balance: Money): Promise<void> => {
    this.updatedBalance = balance.toDecimalString();
  });
}

class FakeMovementRepository implements Partial<ICashMovementRepository> {
  public created: CashMovement | null = null;
  create = vi.fn(async (movement: CashMovement): Promise<CashMovement> => {
    this.created = movement;
    return movement;
  });
}

function register(balance: string, tenantId = 't1'): Cash {
  return Cash.create(
    { tenantId, name: 'Main', currency: 'ARS', balance: Money.fromDecimal(balance, 'ARS') },
    'cash-1',
  );
}

describe('CloseCashRegisterUseCase', () => {
  let cashRepo: FakeCashRepository;
  let movementRepo: FakeMovementRepository;
  let executeSpy: ReturnType<typeof vi.fn>;
  let unitOfWork: ICashUnitOfWork;
  let useCase: CloseCashRegisterUseCase;

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
    useCase = new CloseCashRegisterUseCase(unitOfWork, cashRepo as unknown as ICashRepository);
  });

  it('books an INCOME closing movement for an overage and updates the balance to the count', async () => {
    cashRepo.register = register('100.00');

    const output = await useCase.execute({
      tenantId: 't1',
      userId: 'u1',
      cashId: 'cash-1',
      countedAmount: '120.00',
    });

    expect(output.expected).toBe('100.00');
    expect(output.counted).toBe('120.00');
    expect(output.difference).toBe('20.00');
    expect(output.reconciliationMovement?.type).toBe('INCOME');
    expect(output.reconciliationMovement?.category).toBe('closing');
    expect(output.reconciliationMovement?.amount).toBe('20.00');
    expect(movementRepo.create).toHaveBeenCalledOnce();
    expect(cashRepo.updatedBalance).toBe('120.00');
    expect(output.cash.balance).toBe('120.00');
  });

  it('books an EXPENSE closing movement for a shortage', async () => {
    cashRepo.register = register('100.00');

    const output = await useCase.execute({
      tenantId: 't1',
      userId: 'u1',
      cashId: 'cash-1',
      countedAmount: '85.50',
    });

    expect(output.difference).toBe('-14.50');
    expect(output.reconciliationMovement?.type).toBe('EXPENSE');
    expect(output.reconciliationMovement?.amount).toBe('14.50');
    expect(cashRepo.updatedBalance).toBe('85.50');
    expect(output.cash.balance).toBe('85.50');
  });

  it('books no movement and touches nothing for a clean count', async () => {
    cashRepo.register = register('250.00');

    const output = await useCase.execute({
      tenantId: 't1',
      userId: 'u1',
      cashId: 'cash-1',
      countedAmount: '250.00',
    });

    expect(output.difference).toBe('0.00');
    expect(output.reconciliationMovement).toBeNull();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(movementRepo.create).not.toHaveBeenCalled();
    expect(cashRepo.updateBalance).not.toHaveBeenCalled();
    expect(output.cash.balance).toBe('250.00');
  });

  it('throws NotFoundError when the register does not exist', async () => {
    cashRepo.register = null;
    await expect(
      useCase.execute({ tenantId: 't1', userId: 'u1', cashId: 'missing', countedAmount: '10.00' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the register belongs to another tenant', async () => {
    cashRepo.register = register('100.00', 'other-tenant');
    await expect(
      useCase.execute({ tenantId: 't1', userId: 'u1', cashId: 'cash-1', countedAmount: '100.00' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
