import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterUserUseCase } from './register-user.use-case.js';
import { AuthUser } from '../../domain/entities/auth-user.js';
import type { IUserRepository } from '../../domain/repositories/user-repository.js';
import type { IPasswordHasher } from '../../domain/ports/password-hasher.js';
import { ConflictError, ValidationError } from '@domain/errors/index.js';

function makeUsers(): IUserRepository {
  return {
    findByEmail: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    listByTenant: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    create: vi.fn(async (user: AuthUser) => user),
    update: vi.fn(async (user: AuthUser) => user),
  };
}

function makeHasher(): IPasswordHasher {
  return {
    hash: vi.fn().mockResolvedValue('hashed-password'),
    compare: vi.fn().mockResolvedValue(true),
  };
}

const input = {
  tenantId: 'tenant-1',
  email: 'New.User@Example.com',
  password: 'Str0ngPass',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roleId: 'role-1',
};

describe('RegisterUserUseCase', () => {
  let users: IUserRepository;
  let hasher: IPasswordHasher;
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    users = makeUsers();
    hasher = makeHasher();
    useCase = new RegisterUserUseCase(users, hasher);
  });

  it('hashes the password and persists a normalised user', async () => {
    const result = await useCase.execute(input);

    expect(hasher.hash).toHaveBeenCalledWith('Str0ngPass');
    expect(users.create).toHaveBeenCalledOnce();
    const created = vi.mocked(users.create).mock.calls[0]![0];
    expect(created.passwordHash).toBe('hashed-password');
    expect(created.email).toBe('new.user@example.com');
    expect(result.email).toBe('new.user@example.com');
  });

  it('never exposes the password hash in the output', async () => {
    const result = await useCase.execute(input);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('checks email uniqueness within the tenant', async () => {
    await useCase.execute(input);
    expect(users.findByEmail).toHaveBeenCalledWith('tenant-1', 'new.user@example.com');
  });

  it('throws ConflictError when the email already exists in the tenant', async () => {
    vi.mocked(users.findByEmail).mockResolvedValue(
      AuthUser.create({
        tenantId: 'tenant-1',
        email: 'new.user@example.com',
        passwordHash: 'x',
        firstName: 'A',
        lastName: 'B',
        roleId: 'role-1',
      }),
    );

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(users.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid email before touching the repository', async () => {
    await expect(useCase.execute({ ...input, email: 'bad' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('rejects a weak password', async () => {
    await expect(useCase.execute({ ...input, password: 'weak' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(hasher.hash).not.toHaveBeenCalled();
  });
});
