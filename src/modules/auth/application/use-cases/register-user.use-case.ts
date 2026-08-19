import { ConflictError } from '@domain/errors/index.js';
import { AuthUser } from '../../domain/entities/auth-user.js';
import { Email } from '../../domain/value-objects/email.js';
import { Password } from '../../domain/value-objects/password.js';
import type { IPasswordHasher } from '../../domain/ports/password-hasher.js';
import type { IUserRepository } from '../../domain/repositories/user-repository.js';
import { toUserOutput, type RegisterUserInput, type UserOutput } from '../dto/auth-dtos.js';

/**
 * Registers a new user within a tenant.
 *
 * Validates the email and password policies, enforces per-tenant email
 * uniqueness, hashes the password (never storing the plain value) and persists
 * the user (Requirement 8.7).
 */
export class RegisterUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
  ) {}

  async execute(input: RegisterUserInput): Promise<UserOutput> {
    const email = Email.create(input.email);
    const password = Password.create(input.password);

    const existing = await this.users.findByEmail(input.tenantId, email.value);
    if (existing !== null) {
      throw new ConflictError('A user with this email already exists', {
        field: 'email',
      });
    }

    const passwordHash = await this.hasher.hash(password.value);

    const user = AuthUser.create({
      tenantId: input.tenantId,
      email: email.value,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: input.roleId,
      phone: input.phone ?? null,
    });

    const saved = await this.users.create(user);
    return toUserOutput(saved);
  }
}
