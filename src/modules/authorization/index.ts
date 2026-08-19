/**
 * Public façade for the Authorization module.
 *
 * This module is deliberately **separate** from the `auth` (authentication)
 * module to keep the two concerns distinct, following the design's module
 * boundaries: `auth` answers "who are you?" (login, tokens, password hashing)
 * while `authorization` answers "what may you do?" (roles, permissions, RBAC).
 * Other modules and the composition root MUST consume authorization
 * capabilities through this barrel rather than reaching into internals.
 */

// Use cases (application entry points)
export { CreateRoleUseCase } from './application/use-cases/create-role.use-case.js';
export { AssignPermissionUseCase } from './application/use-cases/assign-permission.use-case.js';
export { UpdateRolePermissionsUseCase } from './application/use-cases/update-role-permissions.use-case.js';
export { SeedSystemRolesUseCase } from './application/use-cases/seed-system-roles.use-case.js';

// DTOs
export {
  toRoleOutput,
  type CreateRoleInput,
  type AssignPermissionInput,
  type UpdateRolePermissionsInput,
  type SeedSystemRolesInput,
  type RoleOutput,
  type PermissionInput,
} from './application/dto/authorization-dtos.js';

// Domain entity + value object
export {
  Role,
  type RoleProps,
  type CreateRoleInput as CreateRoleEntityInput,
} from './domain/entities/role.js';
export {
  Permission,
  PERMISSION_WILDCARD,
  type PermissionDescriptor,
} from './domain/value-objects/permission.js';

// Permission catalogue + system role matrix (consumed by provisioning + seeds)
export {
  MODULES,
  SCREENS,
  ACTIONS,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_DEFINITIONS,
  type ModuleName,
  type ScreenName,
  type ActionName,
  type SystemRoleName,
  type SystemRoleDefinition,
} from './domain/constants/permission-catalog.js';

// Ports (implemented by infrastructure)
export type { IRoleRepository } from './domain/repositories/role-repository.js';

// Errors
export { SystemRoleModificationError } from './domain/errors/authorization-errors.js';

// Infrastructure implementations
export {
  PrismaRoleRepository,
  type RolePrismaClient,
  type RoleRow,
  type PermissionRow,
} from './infrastructure/prisma-role-repository.js';
