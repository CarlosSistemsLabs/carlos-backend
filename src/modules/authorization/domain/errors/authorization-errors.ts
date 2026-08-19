import { BusinessRuleError } from '@domain/errors/index.js';

/**
 * Raised when an operation would mutate the protected core of a system role.
 *
 * System roles (Admin, Manager, User) are seeded for every tenant and must keep
 * a stable identity so the platform can rely on their presence. Their name and
 * `isSystem` flag are immutable, and their permissions cannot be stripped,
 * though tenants may still create their own custom roles freely.
 */
export class SystemRoleModificationError extends BusinessRuleError {
  constructor(roleName: string, operation: string) {
    super(`Cannot ${operation} the system role "${roleName}"`, {
      roleName,
      operation,
    });
  }
}
