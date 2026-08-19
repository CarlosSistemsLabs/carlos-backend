export {
  registerInfrastructure,
  createInfrastructureContainer,
  registerFirebaseInfrastructure,
} from './composition-root.js';
export type { InfrastructureDependencies } from './composition-root.js';

export {
  buildFirebaseAdmin,
  DisabledFirebaseAdmin,
  EnabledFirebaseAdmin,
  FirebaseDisabledError,
} from './firebase/index.js';
export type {
  IFirebaseAdmin,
  FirebaseAdminSdk,
  FirebaseAdminSdkLoader,
  FirebaseAdminDeps,
  FirebaseServiceAccount,
  FirebaseLogger,
} from './firebase/index.js';

export {
  Container,
  InjectionToken,
  createToken,
  DependencyResolutionError,
  INFRASTRUCTURE_TOKENS,
} from './di/index.js';
export type { FactoryFn, Lifecycle } from './di/index.js';

export { PrismaRepository } from './repositories/index.js';
export type {
  PrismaModelDelegate,
  PrismaQueryArgs,
  PrismaRepositoryConfig,
} from './repositories/index.js';

export { prisma, disconnectPrisma } from './database/index.js';
