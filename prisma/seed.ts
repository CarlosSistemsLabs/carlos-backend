import { disconnectPrisma } from '@infrastructure/database/index.js';
import {
  Container,
  AUTH_TOKENS,
  AUTHORIZATION_TOKENS,
  SUBSCRIPTION_TOKENS,
  ADMINISTRATION_TOKENS,
} from '@infrastructure/di/index.js';
import {
  registerInfrastructure,
  registerAuthInfrastructure,
  registerAuthorizationInfrastructure,
  registerSubscriptionInfrastructure,
  registerAdministrationInfrastructure,
} from '@infrastructure/composition-root.js';
import { RegisterUserUseCase, BcryptPasswordHasher } from '@modules/auth/index.js';
import { ConflictError } from '@domain/errors/index.js';

/**
 * Database seed / bootstrap entry point.
 *
 * Brings a fresh database to a usable state so an admin can log into the web
 * client with all features available. Composes the existing application use
 * cases (there is no public self-provisioning: `/auth/register` requires an
 * existing tenant + role, and feature-gated routes require an active
 * subscription). Steps, all idempotent so it is safe to re-run:
 *
 *   1. Seed the global plan catalogue (Starter/Business/Enterprise).
 *   2. Create the demo tenant — this also seeds its Admin/Manager/User roles
 *      and default configuration (via the tenant role seeder).
 *   3. Create the first admin user, assigned the seeded Admin role.
 *   4. Give the tenant an active Enterprise subscription so every plan feature
 *      (sales, stock, cash, reports, purchases, dashboard, ai, ...) is unlocked.
 *
 * All values are overridable via environment variables so real deployments can
 * pick their own tenant/admin without editing code.
 */
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'Carlos ERP Demo';
const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? 'demo';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@carlos-erp.test';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';
const ADMIN_FIRST_NAME = process.env.SEED_ADMIN_FIRST_NAME ?? 'Admin';
const ADMIN_LAST_NAME = process.env.SEED_ADMIN_LAST_NAME ?? 'User';
const PLAN_NAME = process.env.SEED_PLAN ?? 'enterprise';

/** The seeded system role granted to the bootstrap admin user. */
const ADMIN_ROLE_NAME = 'Admin';

async function seed(): Promise<void> {
  // Compose the container the same way `config/server.ts` does, but only the
  // slices the bootstrap needs. Order matters: base infra (Prisma client) first.
  const container = registerInfrastructure(new Container());
  await registerAuthInfrastructure(container);
  registerAuthorizationInfrastructure(container);
  registerSubscriptionInfrastructure(container);
  registerAdministrationInfrastructure(container);

  const seedPlans = container.resolve(SUBSCRIPTION_TOKENS.SeedPlansUseCase);
  const createTenant = container.resolve(ADMINISTRATION_TOKENS.CreateTenantUseCase);
  const createSubscription = container.resolve(SUBSCRIPTION_TOKENS.CreateSubscriptionUseCase);
  const tenants = container.resolve(ADMINISTRATION_TOKENS.TenantRepository);
  const roles = container.resolve(AUTHORIZATION_TOKENS.RoleRepository);
  const users = container.resolve(AUTH_TOKENS.UserRepository);
  const plans = container.resolve(SUBSCRIPTION_TOKENS.PlanRepository);

  // 1. Plan catalogue (global, idempotent by plan name).
  await seedPlans.execute();
  console.log('OK  Plans seeded (starter/business/enterprise)');

  // 2. Tenant (+ default roles + configuration). Idempotent by slug.
  let tenantId: string;
  try {
    const tenant = await createTenant.execute({ name: TENANT_NAME, slug: TENANT_SLUG });
    tenantId = tenant.id;
    console.log(`OK  Tenant created: "${TENANT_NAME}" (${TENANT_SLUG}) -> ${tenantId}`);
  } catch (error) {
    if (error instanceof ConflictError) {
      const existing = await tenants.findBySlug(TENANT_SLUG);
      if (existing === null) {
        throw error;
      }
      tenantId = existing.id;
      console.log(`--  Tenant already exists: ${TENANT_SLUG} -> ${tenantId}`);
    } else {
      throw error;
    }
  }

  // 3. Admin role (seeded by CreateTenant) + first admin user (idempotent by email).
  const adminRole = await roles.findByName(tenantId, ADMIN_ROLE_NAME);
  if (adminRole === null) {
    throw new Error(`Expected the "${ADMIN_ROLE_NAME}" role to be seeded for the tenant`);
  }

  const existingUser = await users.findByEmail(tenantId, ADMIN_EMAIL);
  if (existingUser === null) {
    const registerUser = new RegisterUserUseCase(users, new BcryptPasswordHasher());
    await registerUser.execute({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      firstName: ADMIN_FIRST_NAME,
      lastName: ADMIN_LAST_NAME,
      roleId: adminRole.id,
    });
    console.log(`OK  Admin user created: ${ADMIN_EMAIL}`);
  } else {
    console.log(`--  Admin user already exists: ${ADMIN_EMAIL}`);
  }

  // 4. Active subscription so feature-gated routes pass (supersedes any prior).
  const plan = await plans.findByName(PLAN_NAME);
  if (plan === null) {
    throw new Error(`Plan "${PLAN_NAME}" not found after seeding the catalogue`);
  }
  await createSubscription.execute({ tenantId, planId: plan.id });
  console.log(`OK  Subscription active on plan "${PLAN_NAME}"`);

  console.log('\n=== Seed complete ===');
  console.log(`Tenant id : ${tenantId}`);
  console.log(`Login     : ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
  console.log('Change the admin password after the first login.');
}

seed()
  .catch((error: unknown) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
