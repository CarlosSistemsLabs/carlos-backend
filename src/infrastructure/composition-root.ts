import type { PrismaClient } from '@prisma/client';
import { prisma, tenantPrisma, systemPrisma } from '@infrastructure/database/index.js';
import {
  Container,
  INFRASTRUCTURE_TOKENS,
  AUTH_TOKENS,
  AUTHORIZATION_TOKENS,
  SUBSCRIPTION_TOKENS,
  PRODUCT_TOKENS,
  STOCK_TOKENS,
  CUSTOMER_TOKENS,
  SUPPLIER_TOKENS,
  SALES_TOKENS,
  PURCHASE_TOKENS,
  CASH_TOKENS,
  REPORT_TOKENS,
  ADMINISTRATION_TOKENS,
} from '@infrastructure/di/index.js';
import { env, type Environment } from '@config/environment';
import {
  JwtTokenService,
  PrismaUserRepository,
  PrismaRefreshTokenRepository,
  StructuredAuthEventLogger,
  DetectingAuthEventLogger,
  type ITokenService,
  type UserPrismaClient,
  type RefreshTokenPrismaClient,
  type StructuredLogger,
} from '@modules/auth/index.js';
import {
  PrismaRoleRepository,
  SeedSystemRolesUseCase,
  type RolePrismaClient,
  type IRoleRepository,
} from '@modules/authorization/index.js';
import {
  PrismaFeatureAccessService,
  PrismaPlanRepository,
  PrismaSubscriptionRepository,
  CreateSubscriptionUseCase,
  CheckFeatureAccessUseCase,
  SeedPlansUseCase,
  GetCurrentSubscriptionUseCase,
  ListPlansUseCase,
  UpgradeSubscriptionUseCase,
  type FeatureAccessPrismaClient,
  type PlanPrismaClient,
  type SubscriptionPrismaClient,
  type IPlanRepository,
  type ISubscriptionRepository,
  type IFeatureAccessService,
} from '@modules/subscriptions/index.js';
import {
  PrismaProductRepository,
  PrismaCategoryRepository,
  CreateProductUseCase,
  UpdateProductUseCase,
  DeleteProductUseCase,
  GetProductUseCase,
  ListProductsUseCase,
  SearchProductsUseCase,
  CreateCategoryUseCase,
  UpdateCategoryUseCase,
  DeleteCategoryUseCase,
  GetCategoryUseCase,
  ListCategoriesUseCase,
  GetCategoryTreeUseCase,
  type ProductPrismaClient,
  type CategoryPrismaClient,
  type IProductRepository,
  type ICategoryRepository,
} from '@modules/products/index.js';
import {
  PrismaStockRepository,
  PrismaStockMovementRepository,
  PrismaStockUnitOfWork,
  AdjustStockUseCase,
  GetStockLevelsUseCase,
  RecordStockMovementUseCase,
  GetStockMovementHistoryUseCase,
  ListStockMovementsByCursorUseCase,
  StockEventHandlers,
  type StockEventLogger,
  type StockPrismaClient,
  type StockMovementPrismaClient,
  type TransactionalPrismaClient,
  type IStockRepository,
  type IStockMovementRepository,
  type IStockMovementCursorReader,
  type IStockUnitOfWork,
} from '@modules/stock/index.js';
import {
  PrismaCustomerRepository,
  CreateCustomerUseCase,
  UpdateCustomerUseCase,
  DeleteCustomerUseCase,
  GetCustomerUseCase,
  ListCustomersUseCase,
  SearchCustomersUseCase,
  type CustomerPrismaClient,
  type ICustomerRepository,
} from '@modules/customers/index.js';
import {
  PrismaSupplierRepository,
  CreateSupplierUseCase,
  UpdateSupplierUseCase,
  DeleteSupplierUseCase,
  GetSupplierUseCase,
  ListSuppliersUseCase,
  SearchSuppliersUseCase,
  type SupplierPrismaClient,
  type ISupplierRepository,
} from '@modules/suppliers/index.js';
import {
  PrismaSaleRepository,
  PrismaSaleUnitOfWork,
  PrismaSaleProductReader,
  PrismaSaleCustomerReader,
  CreateSaleUseCase,
  GetSaleUseCase,
  ListSalesUseCase,
  UpdateSaleStatusUseCase,
  DeleteSaleUseCase,
  type SalePrismaClient,
  type TransactionalPrismaClient as SaleTransactionalPrismaClient,
  type SaleProductReaderPrismaClient,
  type SaleCustomerReaderPrismaClient,
  type ISaleRepository,
  type ISaleUnitOfWork,
  type ISaleProductReader,
  type ISaleCustomerReader,
} from '@modules/sales/index.js';
import {
  PrismaPurchaseRepository,
  PrismaPurchaseUnitOfWork,
  PrismaPurchaseProductReader,
  PrismaPurchaseSupplierReader,
  CreatePurchaseUseCase,
  GetPurchaseUseCase,
  ListPurchasesUseCase,
  UpdatePurchaseStatusUseCase,
  DeletePurchaseUseCase,
  type PurchasePrismaClient,
  type TransactionalPrismaClient as PurchaseTransactionalPrismaClient,
  type PurchaseProductReaderPrismaClient,
  type PurchaseSupplierReaderPrismaClient,
  type IPurchaseRepository,
  type IPurchaseUnitOfWork,
  type IPurchaseProductReader,
  type IPurchaseSupplierReader,
} from '@modules/purchases/index.js';
import {
  PrismaCashRepository,
  PrismaCashMovementRepository,
  PrismaPaymentRepository,
  PrismaCashUnitOfWork,
  PrismaPaymentSaleReader,
  PrismaPaymentPurchaseReader,
  OpenCashRegisterUseCase,
  CloseCashRegisterUseCase,
  RecordCashMovementUseCase,
  ListCashMovementsUseCase,
  RecordPaymentUseCase,
  GetPaymentStatusUseCase,
  ListPaymentsUseCase,
  type CashPrismaClient,
  type CashMovementPrismaClient,
  type PaymentPrismaClient,
  type TransactionalPrismaClient as CashTransactionalPrismaClient,
  type PaymentSaleReaderPrismaClient,
  type PaymentPurchaseReaderPrismaClient,
  type ICashRepository,
  type ICashMovementRepository,
  type ICashUnitOfWork,
  type IPaymentRepository,
  type IPaymentSaleReader,
  type IPaymentPurchaseReader,
} from '@modules/cash/index.js';
import {
  PrismaSalesReportReader,
  PrismaStockReportReader,
  PrismaCashFlowReportReader,
  PrismaCustomerReportReader,
  PrismaProductPerformanceReader,
  SalesReportUseCase,
  StockReportUseCase,
  CashFlowReportUseCase,
  CustomerReportUseCase,
  ProductPerformanceReportUseCase,
  type SalesReportPrismaClient,
  type StockReportPrismaClient,
  type CashFlowReportPrismaClient,
  type CustomerReportPrismaClient,
  type ProductPerformancePrismaClient,
  type ISalesReportReader,
  type IStockReportReader,
  type ICashFlowReportReader,
  type ICustomerReportReader,
  type IProductPerformanceReader,
} from '@modules/reports/index.js';
import {
  PrismaTenantRepository,
  PrismaConfigurationRepository,
  PrismaAuditLogRepository,
  CreateTenantUseCase,
  UpdateTenantBrandingUseCase,
  UpdateBrandingUseCase,
  GetBrandingUseCase,
  SetConfigurationUseCase,
  GetConfigurationUseCase,
  ListConfigurationsUseCase,
  toTenantOutput,
  DEFAULT_BRANDING_CACHE_TTL_SECONDS,
  type TenantPrismaClient,
  type ConfigurationPrismaClient,
  type AuditLogPrismaClient,
  type ITenantRepository,
  type IConfigurationRepository,
} from '@modules/administration/index.js';
import type { ICache } from '@application/ports/cache.js';
import type { ISessionStore } from '@application/ports/session-store.js';
import type { IStorageService } from '@application/ports/storage.js';
import type { ISuspiciousActivityDetector } from '@common/alerting';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { buildCache } from '@infrastructure/cache/redis-cache.js';
import { MultiLevelCache } from '@infrastructure/cache/multi-level-cache.js';
import { CacheKeys } from '@infrastructure/cache/cache-keys.js';
import { CacheWarmer, type CacheWarmLoader } from '@infrastructure/cache/cache-warmer.js';
import { buildSessionStore } from '@infrastructure/cache/session-store.js';
import { StubStorageService } from '@infrastructure/storage/stub-storage-service.js';
import type { IEventBus } from '@domain/events/index.js';
import { InMemoryEventBus } from '@infrastructure/events/in-memory-event-bus.js';
import {
  buildFirebaseAdmin,
  DisabledFirebaseAdmin,
  type IFirebaseAdmin,
  type FirebaseAdminDeps,
} from '@infrastructure/firebase/index.js';
import { StructuredLogAnalyticsService, type IAnalyticsService } from '@common/analytics';
import {
  StructuredLogCrashReporter,
  type ICrashReporter,
  type CrashReporterLogger,
} from '@common/crash-reporting';
import {
  FirebaseRemoteConfigService,
  type IRemoteConfigService,
  type RemoteConfigLogger,
} from '@common/remote-config';
import {
  PluginRegistry,
  PluginLoader,
  PluginActivationService,
  type PluginLogger,
  type PluginConfigResolver,
  type PluginFeatureAccess,
} from '../plugins/index.js';
import {
  ResilientAIService,
  type IAIService,
  type AIProvider,
  type AIInteractionLogger,
} from '../ai/index.js';

/** Overrides accepted when composing the infrastructure container (testing). */
export interface InfrastructureDependencies {
  /** Substitute Prisma client (e.g. a mock) for tests. */
  prismaClient?: PrismaClient;
  /**
   * Substitute cache implementation. Defaults to {@link buildCache} — a
   * Redis-backed cache when `REDIS_URL` is set, otherwise an {@link InMemoryCache}.
   */
  cache?: ICache;
  /**
   * Substitute cache warmer. Defaults to a {@link CacheWarmer} that pre-loads
   * each tenant's configuration + branding into the multi-level cache (task
   * 39.2, Requirement 31.4).
   */
  cacheWarmer?: CacheWarmer;
  /**
   * Substitute session store. Defaults to {@link buildSessionStore} — a
   * Redis-backed store when `REDIS_URL` is set, otherwise an in-process store.
   */
  sessionStore?: ISessionStore;
  /** Substitute storage service (defaults to {@link StubStorageService}). */
  storageService?: IStorageService;
  /** Substitute analytics service (defaults to {@link StructuredLogAnalyticsService}). */
  analyticsService?: IAnalyticsService;
  /** Substitute crash reporter (defaults to {@link StructuredLogCrashReporter}). */
  crashReporter?: ICrashReporter;
  /** Substitute Remote Config service (defaults to {@link FirebaseRemoteConfigService}). */
  remoteConfigService?: IRemoteConfigService;
  /** Substitute plugin registry (defaults to an empty {@link PluginRegistry}). */
  pluginRegistry?: PluginRegistry;
  /** Substitute plugin loader (defaults to a {@link PluginLoader} over the registry). */
  pluginLoader?: PluginLoader;
  /**
   * Per-plugin config resolver for the default {@link PluginLoader}. Defaults to
   * a resolver returning an empty record; a per-tenant secrets / Remote Config
   * source binds here later. The discovery source (the ordered list of plugin
   * {@link PluginFactory} functions) is supplied to `loader.load(...)` by boot
   * code (task 35.3), keeping this a deterministic, injectable seam.
   */
  pluginConfigResolver?: PluginConfigResolver;
  /** Substitute per-tenant activation service (defaults to a {@link PluginActivationService}). */
  pluginActivationService?: PluginActivationService;
  /**
   * Substitute AI service (defaults to a {@link ResilientAIService} configured
   * with NO providers → disabled / graceful degradation, Requirement 20.5).
   */
  aiService?: IAIService;
  /**
   * AI providers (OpenAI/Claude/Gemini adapters) composed by the default
   * {@link ResilientAIService} in failover order (Requirement 20.2). Defaults to
   * an EMPTY list, which yields graceful degradation until concrete adapters are
   * bound. Ignored when {@link aiService} is supplied.
   */
  aiProviders?: readonly AIProvider[];
}

/**
 * Registers infrastructure-provided dependencies (database client, and — as
 * they are added — caches, event bus, storage, and repositories) on the given
 * container.
 *
 * This is the infrastructure module's composition root: the single place where
 * concrete implementations are bound to their abstractions. Keeping
 * registration here means feature modules and the application layer never
 * import infrastructure concretions directly (Clean Architecture,
 * Requirement 3.2).
 *
 * @param container - The container to populate.
 * @param overrides - Optional dependency substitutions, primarily for tests.
 * @returns The same container, to allow fluent composition.
 */
export function registerInfrastructure(
  container: Container,
  overrides: InfrastructureDependencies = {},
): Container {
  container.registerValue(INFRASTRUCTURE_TOKENS.PrismaClient, overrides.prismaClient ?? prisma);
  if (!container.has(INFRASTRUCTURE_TOKENS.EventBus)) {
    container.register(
      INFRASTRUCTURE_TOKENS.EventBus,
      () =>
        new InMemoryEventBus((error, event) => {
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'Event handler failed',
              eventName: event.eventName(),
              eventId: event.eventId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }),
    );
  }
  // Cross-cutting cache + session storage + storage abstractions. The cache and
  // session store bind to Redis when REDIS_URL is configured and to in-process
  // implementations otherwise (task 39.1, Requirement 31.2) — via buildCache /
  // buildSessionStore, which mirror buildFirebaseAdmin: env is the sole source
  // (so TEST/PRODUCTION point at separate Redis instances) and the Redis client
  // connects LAZILY on first use, never blocking boot. Cloud storage (task 33.x)
  // still binds to the local stub for now. Registered idempotently so a
  // caller-supplied (test) container can inject fakes first.
  if (!container.has(INFRASTRUCTURE_TOKENS.Cache)) {
    // Default to the multi-level (L1-over-L2) cache (task 39.2, Requirement
    // 31.4): a small, short-TTL, per-instance InMemoryCache (L1 — hot data
    // served without the network) over buildCache(env) (L2 — Redis when
    // REDIS_URL is set, shared across horizontally-scaled instances; an
    // InMemoryCache otherwise). Reads check L1 then L2 (promoting L2 hits into
    // L1); writes/invalidations hit BOTH tiers, so a change is reflected within
    // the 30-second budget and cross-instance L1 staleness is bounded by the
    // short L1 TTL. When REDIS_URL is absent L2 is itself in-process, so this
    // degenerates to an in-process cache over another — harmless and keeps the
    // composition identical either way. Registered idempotently so a
    // caller-supplied (test) container can inject a fake cache first.
    const cache =
      overrides.cache ?? new MultiLevelCache({ l1: new InMemoryCache(), l2: buildCache(env) });
    container.registerValue(INFRASTRUCTURE_TOKENS.Cache, cache);
  }
  // Cache warmer for tenant configurations (task 39.2, Requirement 31.4). The
  // default is a CacheWarmer whose loaders pre-load each tenant's configuration
  // list and branding projection into the multi-level Cache, so the first read
  // after a cold start is served from cache instead of the database. It is wired
  // as a LAZY factory because its loaders resolve the Administration
  // configuration/tenant repositories, which are bound by the separate
  // registerAdministrationInfrastructure(...): the loaders resolve those repos at
  // first use (by which time administration has been registered) and, defensively,
  // no-op when they are absent. Warming is best-effort and never throws — a failed
  // warm simply defers to lazy cache-aside population. Registered idempotently so
  // a caller-supplied (test) container can inject a fake first.
  if (!container.has(INFRASTRUCTURE_TOKENS.CacheWarmer)) {
    if (overrides.cacheWarmer !== undefined) {
      container.registerValue(INFRASTRUCTURE_TOKENS.CacheWarmer, overrides.cacheWarmer);
    } else {
      container.register(INFRASTRUCTURE_TOKENS.CacheWarmer, (c) => {
        const cache = c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache;
        const loaders: CacheWarmLoader[] = [
          {
            name: 'tenant-configurations',
            key: (tenantId) => CacheKeys.tenantConfigurations(tenantId),
            load: async (tenantId) => {
              if (!c.has(ADMINISTRATION_TOKENS.ConfigurationRepository)) {
                return null;
              }
              const configs = c.resolve(
                ADMINISTRATION_TOKENS.ConfigurationRepository,
              ) as IConfigurationRepository;
              return configs.list(tenantId);
            },
          },
          {
            name: 'tenant-branding',
            key: (tenantId) => CacheKeys.branding(tenantId),
            ttlSeconds: DEFAULT_BRANDING_CACHE_TTL_SECONDS,
            load: async (tenantId) => {
              if (!c.has(ADMINISTRATION_TOKENS.TenantRepository)) {
                return null;
              }
              const tenants = c.resolve(
                ADMINISTRATION_TOKENS.TenantRepository,
              ) as ITenantRepository;
              const tenant = await tenants.findById(tenantId);
              return tenant === null ? null : toTenantOutput(tenant);
            },
          },
        ];
        return new CacheWarmer({ cache, loaders });
      });
    }
  }
  if (!container.has(INFRASTRUCTURE_TOKENS.SessionStore)) {
    const sessionStore = overrides.sessionStore ?? buildSessionStore(env);
    container.registerValue(INFRASTRUCTURE_TOKENS.SessionStore, sessionStore);
  }
  if (!container.has(INFRASTRUCTURE_TOKENS.StorageService)) {
    const storage = overrides.storageService ?? new StubStorageService();
    container.registerValue(INFRASTRUCTURE_TOKENS.StorageService, storage);
  }
  // Cross-cutting analytics service (task 33.2, Requirements 13.1–13.4). The
  // structured-log sink is the default: it emits each event as an
  // `event: 'analytics'` log line that a log-based analytics pipeline / GA4
  // BigQuery export consumes. A GA4 Measurement Protocol implementation binds to
  // the SAME IAnalyticsService port later. Registered idempotently so a
  // caller-supplied (test) container can inject a fake (e.g. NoopAnalyticsService)
  // first. The default sink reuses the fallback structured logger until bootstrap
  // injects the application's pino logger.
  if (!container.has(INFRASTRUCTURE_TOKENS.AnalyticsService)) {
    const analytics: IAnalyticsService =
      overrides.analyticsService ?? new StructuredLogAnalyticsService(defaultStructuredLogger);
    container.registerValue(INFRASTRUCTURE_TOKENS.AnalyticsService, analytics);
  }
  // Cross-cutting crash / error-reporting seam (task 33.3, Requirements 13.6,
  // 21.8). The structured-log reporter is the default: 5xx/unknown errors are
  // forwarded as `event:'error_report'` lines that the ops pipeline routes to an
  // external crash tracker. A real server reporter (Sentry, etc.) binds to the
  // SAME ICrashReporter port later. Registered idempotently so a caller-supplied
  // (test) container can inject a fake (e.g. NoopCrashReporter) first. The
  // default reuses the fallback structured logger until bootstrap injects the
  // application's pino logger; the server bootstrap additionally constructs an
  // app.log-bound reporter for the request-path error handler. NOTE: the actual
  // Firebase Crashlytics integration lives in the Android (task 51.3) and iOS
  // (task 56.3) clients — there is no server-side Crashlytics SDK.
  if (!container.has(INFRASTRUCTURE_TOKENS.CrashReporter)) {
    const crashReporter: ICrashReporter =
      overrides.crashReporter ?? new StructuredLogCrashReporter(defaultCrashLogger);
    container.registerValue(INFRASTRUCTURE_TOKENS.CrashReporter, crashReporter);
  }
  // Cross-cutting Remote Config service (task 33.5, Requirement 14.7). The
  // Firebase-backed service is the default: it reads the server-side Remote
  // Config template (feature flags + dynamic config, Requirement 14.4) through
  // the env-scoped IFirebaseAdmin, so TEST/PRODUCTION read their own separate
  // settings automatically (Requirement 14.7). Registered idempotently so a
  // caller-supplied (test) container can inject a fake (e.g.
  // StaticRemoteConfigService) first. Because IFirebaseAdmin is bound by the
  // SEPARATE async registerFirebaseInfrastructure(...), the default is wired as
  // a LAZY factory: it resolves the Firebase client at first use (by which time
  // Firebase has been registered) and falls back to a disabled client — which
  // makes the service return caller defaults, never throwing — when Firebase was
  // not registered or reports isEnabled === false.
  if (!container.has(INFRASTRUCTURE_TOKENS.RemoteConfig)) {
    if (overrides.remoteConfigService !== undefined) {
      container.registerValue(INFRASTRUCTURE_TOKENS.RemoteConfig, overrides.remoteConfigService);
    } else {
      container.register(INFRASTRUCTURE_TOKENS.RemoteConfig, (c) => {
        const firebaseAdmin: IFirebaseAdmin = c.has(INFRASTRUCTURE_TOKENS.FirebaseAdmin)
          ? c.resolve(INFRASTRUCTURE_TOKENS.FirebaseAdmin)
          : new DisabledFirebaseAdmin();
        return new FirebaseRemoteConfigService(firebaseAdmin, defaultRemoteConfigLogger);
      });
    }
  }
  // Cross-cutting Plugin System registry (task 35.1, Requirements 19.1/19.4).
  // The default is an empty in-memory PluginRegistry — the single catalogue of
  // installed plugins that keeps external integrations decoupled from domain
  // code. Registered idempotently so a caller-supplied (test) container can
  // inject a pre-seeded registry first. Task 35.2 builds plugin
  // loading/discovery + per-tenant activation ON TOP of this catalogue, and
  // task 35.3 registers concrete adapters into it, with no call-site changes.
  if (!container.has(INFRASTRUCTURE_TOKENS.PluginRegistry)) {
    const pluginRegistry = overrides.pluginRegistry ?? new PluginRegistry();
    container.registerValue(INFRASTRUCTURE_TOKENS.PluginRegistry, pluginRegistry);
  }
  // Plugin loader/discovery (task 35.2, Requirements 19.3/19.5). The default is
  // a PluginLoader over the resolved registry: it discovers plugins from an
  // EXPLICIT list of factories (passed to loader.load(...) by boot code — no
  // filesystem scan / dynamic import), registers each and drives it through
  // initialize→activate with graceful degradation (a single failing plugin is
  // logged + recorded and never crashes boot). Registered idempotently so a
  // caller-supplied (test) container can inject a fake first.
  if (!container.has(INFRASTRUCTURE_TOKENS.PluginLoader)) {
    if (overrides.pluginLoader !== undefined) {
      container.registerValue(INFRASTRUCTURE_TOKENS.PluginLoader, overrides.pluginLoader);
    } else {
      container.register(INFRASTRUCTURE_TOKENS.PluginLoader, (c) => {
        return new PluginLoader({
          registry: c.resolve(INFRASTRUCTURE_TOKENS.PluginRegistry),
          logger: defaultPluginLogger,
          ...(overrides.pluginConfigResolver !== undefined
            ? { configResolver: overrides.pluginConfigResolver }
            : {}),
        });
      });
    }
  }
  // Per-tenant plugin activation (task 35.2, Requirement 19.6). The default is a
  // PluginActivationService that reuses the EXISTING feature-access mechanism —
  // the same IFeatureAccessService behind app.requireFeature (plan + per-tenant
  // feature-flag resolution) — to decide whether a plugin is active for a
  // tenant, rather than duplicating flag logic. It is wired as a LAZY factory
  // because the FeatureAccessService is bound by the separate
  // registerSubscriptionInfrastructure(...): it resolves that service at first
  // use (by which time subscriptions have been registered) and falls back to a
  // deny-all port (no tenant is granted a plugin) that logs a warning when
  // subscriptions were not registered — never throwing. Registered idempotently
  // so a caller-supplied (test) container can inject a fake first.
  if (!container.has(INFRASTRUCTURE_TOKENS.PluginActivationService)) {
    if (overrides.pluginActivationService !== undefined) {
      container.registerValue(
        INFRASTRUCTURE_TOKENS.PluginActivationService,
        overrides.pluginActivationService,
      );
    } else {
      container.register(INFRASTRUCTURE_TOKENS.PluginActivationService, (c) => {
        const featureAccess: PluginFeatureAccess = c.has(SUBSCRIPTION_TOKENS.FeatureAccessService)
          ? c.resolve(SUBSCRIPTION_TOKENS.FeatureAccessService)
          : denyAllFeatureAccess;
        return new PluginActivationService({ featureAccess, logger: defaultPluginLogger });
      });
    }
  }
  // AI Integration Layer — resilient wrapper (task 37.2, Requirements
  // 20.2/20.4/20.5/20.6). The default is a ResilientAIService configured with NO
  // providers, which is DELIBERATE: with an empty provider list the service
  // reports isEnabled() === false and every completion throws AIUnavailableError,
  // so callers skip AI and continue the core operation (graceful degradation,
  // Requirement 20.5) — no vendor SDK is imported and no network call is made in
  // this environment (Requirement 20.3). It enforces the per-operation timeout
  // budget (10s/30s/60s, Requirement 20.4), fails over between providers
  // (Requirement 20.2) and logs each interaction for cost tracking
  // (Requirement 20.6). Concrete OpenAI/Claude/Gemini adapters (built on the
  // plugin AI integrations) bind LATER via `overrides.aiProviders` — or a fully
  // custom service via `overrides.aiService` — with no call-site changes; a
  // future circuit breaker / retry (tasks 41.x) wraps each provider without
  // touching this binding. Registered idempotently so a caller-supplied (test)
  // container can inject a fake first.
  if (!container.has(INFRASTRUCTURE_TOKENS.AIService)) {
    const aiService: IAIService =
      overrides.aiService ??
      new ResilientAIService({
        providers: overrides.aiProviders ?? [],
        logger: defaultAiInteractionLogger,
      });
    container.registerValue(INFRASTRUCTURE_TOKENS.AIService, aiService);
  }
  return container;
}

/**
 * Builds and returns a container with all infrastructure dependencies
 * registered. Convenience entry point for application bootstrap.
 */
export function createInfrastructureContainer(
  overrides: InfrastructureDependencies = {},
): Container {
  return registerInfrastructure(new Container(), overrides);
}

/**
 * Registers the Firebase Admin client ({@link IFirebaseAdmin}) as a singleton on
 * the container (task 33.1, Requirements 13.5/14.2).
 *
 * Building is asynchronous because initializing the real SDK is done via a lazy
 * dynamic import on the enabled path. In this environment (and any deployment
 * without provisioned credentials) it resolves to a no-op client with
 * `isEnabled === false`, logging a single info line rather than throwing —
 * mirroring how {@link registerAuthInfrastructure} falls back to ephemeral keys.
 * When `FIREBASE_SERVICE_ACCOUNT`/`FIREBASE_SERVICE_ACCOUNT_PATH` are present the
 * service account is validated and a singleton admin app is initialized; env is
 * the sole source of the project id/credentials, so TEST and PRODUCTION
 * deployments target separate Firebase projects automatically (Requirement 14.2).
 *
 * Registered idempotently so a caller-supplied (test) container that already
 * bound a fake Firebase client is reused as-is. The Analytics (task 33.2) and
 * Remote Config (task 33.5) services build on the registered client.
 *
 * @param container - The container to populate.
 * @param environment - Environment configuration (defaults to the loaded env).
 * @param deps - Optional test seams forwarded to {@link buildFirebaseAdmin}.
 * @returns The same container, to allow fluent composition.
 */
export async function registerFirebaseInfrastructure(
  container: Container,
  environment: Environment = env,
  deps: FirebaseAdminDeps = {},
): Promise<Container> {
  if (!container.has(INFRASTRUCTURE_TOKENS.FirebaseAdmin)) {
    const firebaseAdmin: IFirebaseAdmin = await buildFirebaseAdmin(environment, deps);
    container.registerValue(INFRASTRUCTURE_TOKENS.FirebaseAdmin, firebaseAdmin);
  }
  return container;
}

/**
 * Builds the {@link ITokenService} for the running environment.
 *
 * Uses the configured RS256 PEM keypair when present (required in production —
 * enforced by the environment loader); otherwise falls back to a freshly
 * generated, in-memory keypair so local development and tests run without
 * provisioning real keys (Requirement 8.1).
 */
export async function buildTokenService(environment: Environment = env): Promise<ITokenService> {
  if (environment.JWT_PRIVATE_KEY !== undefined && environment.JWT_PUBLIC_KEY !== undefined) {
    return JwtTokenService.fromPem({
      privateKeyPem: environment.JWT_PRIVATE_KEY,
      publicKeyPem: environment.JWT_PUBLIC_KEY,
      accessTtl: environment.JWT_ACCESS_TTL,
      refreshTtl: environment.JWT_REFRESH_TTL,
      issuer: environment.JWT_ISSUER,
    });
  }

  return JwtTokenService.withEphemeralKeys({
    accessTtl: environment.JWT_ACCESS_TTL,
    refreshTtl: environment.JWT_REFRESH_TTL,
    issuer: environment.JWT_ISSUER,
  });
}

/**
 * Registers the Authentication module's infrastructure (token service +
 * Prisma-backed repositories) on the container.
 *
 * Auth persistence is deliberately bound to the UNEXTENDED Prisma client
 * because authentication lookups occur before a tenant context exists; the
 * repositories scope by `tenantId` by hand where required. Building the token
 * service is asynchronous (it may import or generate RS256 keys), so this
 * registration is async and must be awaited during bootstrap.
 *
 * @param container - The container to populate (infrastructure must already be
 *   registered so {@link INFRASTRUCTURE_TOKENS.PrismaClient} resolves).
 * @param environment - Environment configuration (defaults to the loaded env).
 * @returns The same container, to allow fluent composition.
 */
export async function registerAuthInfrastructure(
  container: Container,
  environment: Environment = env,
  logger: StructuredLogger = defaultStructuredLogger,
  detector?: ISuspiciousActivityDetector,
): Promise<Container> {
  const tokenService = await buildTokenService(environment);
  container.registerValue(AUTH_TOKENS.TokenService, tokenService);

  container.register(AUTH_TOKENS.UserRepository, (c) => {
    const client = c.resolve(INFRASTRUCTURE_TOKENS.PrismaClient) as unknown as UserPrismaClient;
    return new PrismaUserRepository(client);
  });
  container.register(AUTH_TOKENS.RefreshTokenRepository, (c) => {
    const client = c.resolve(
      INFRASTRUCTURE_TOKENS.PrismaClient,
    ) as unknown as RefreshTokenPrismaClient;
    return new PrismaRefreshTokenRepository(client);
  });
  // Structured audit logger (Requirement 17.7). When a suspicious-activity
  // detector is supplied (task 31.4, Requirement 17.8) the logger is decorated
  // so failed-login/lockout events ALSO feed the detector — the auth use cases
  // remain unaware, depending only on the IAuthEventLogger port.
  const auditLogger = new StructuredAuthEventLogger(logger);
  container.registerValue(
    AUTH_TOKENS.AuthEventLogger,
    detector === undefined ? auditLogger : new DetectingAuthEventLogger(auditLogger, detector),
  );

  return container;
}

/**
 * Registers the Authorization (RBAC) module's infrastructure (Prisma-backed
 * role repository) on the container.
 *
 * The role repository is bound to the UNEXTENDED Prisma client and scopes by
 * `tenantId` explicitly: role seeding/provisioning happens before a tenant
 * request context exists, and the `Permission` model is not tenant-scoped. See
 * {@link PrismaRoleRepository} for the full rationale.
 *
 * @param container - The container to populate (infrastructure must already be
 *   registered so {@link INFRASTRUCTURE_TOKENS.PrismaClient} resolves).
 * @returns The same container, to allow fluent composition.
 */
export function registerAuthorizationInfrastructure(container: Container): Container {
  container.register(AUTHORIZATION_TOKENS.RoleRepository, (c) => {
    const client = c.resolve(INFRASTRUCTURE_TOKENS.PrismaClient) as unknown as RolePrismaClient;
    return new PrismaRoleRepository(client);
  });

  return container;
}

/**
 * Registers the Subscriptions module's infrastructure (Prisma-backed feature
 * access service) on the container.
 *
 * The service is bound to the UNEXTENDED Prisma client and scopes by `tenantId`
 * explicitly: the `requireFeature` guard runs as a route-level `preHandler`
 * before the request's tenant id is propagated into the async context, so the
 * extended client's automatic tenant filter cannot be relied upon. See
 * {@link PrismaFeatureAccessService} for the full rationale.
 *
 * @param container - The container to populate (infrastructure must already be
 *   registered so {@link INFRASTRUCTURE_TOKENS.PrismaClient} resolves).
 * @returns The same container, to allow fluent composition.
 */
export function registerSubscriptionInfrastructure(container: Container): Container {
  container.register(SUBSCRIPTION_TOKENS.FeatureAccessService, (c) => {
    const client = c.resolve(
      INFRASTRUCTURE_TOKENS.PrismaClient,
    ) as unknown as FeatureAccessPrismaClient;
    return new PrismaFeatureAccessService(client);
  });

  // Plan catalogue persistence is GLOBAL — bound to the UNEXTENDED systemPrisma
  // client because `Plan` has no tenantId (nothing for the tenant filter to
  // inject). Subscriptions are tenant-owned, so the subscription repository is
  // bound to the tenant-aware `tenantPrisma` client (which also applies the
  // tenant explicitly for defence-in-depth, Requirement 1.5).
  container.register(
    SUBSCRIPTION_TOKENS.PlanRepository,
    () => new PrismaPlanRepository(systemPrisma as unknown as PlanPrismaClient),
  );
  container.register(
    SUBSCRIPTION_TOKENS.SubscriptionRepository,
    () => new PrismaSubscriptionRepository(tenantPrisma as unknown as SubscriptionPrismaClient),
  );

  container.register(SUBSCRIPTION_TOKENS.CreateSubscriptionUseCase, (c) => {
    return new CreateSubscriptionUseCase(
      c.resolve(SUBSCRIPTION_TOKENS.SubscriptionRepository) as ISubscriptionRepository,
      c.resolve(SUBSCRIPTION_TOKENS.PlanRepository) as IPlanRepository,
    );
  });
  container.register(SUBSCRIPTION_TOKENS.CheckFeatureAccessUseCase, (c) => {
    return new CheckFeatureAccessUseCase(
      c.resolve(SUBSCRIPTION_TOKENS.FeatureAccessService) as IFeatureAccessService,
    );
  });
  container.register(SUBSCRIPTION_TOKENS.SeedPlansUseCase, (c) => {
    return new SeedPlansUseCase(c.resolve(SUBSCRIPTION_TOKENS.PlanRepository) as IPlanRepository);
  });
  container.register(SUBSCRIPTION_TOKENS.GetCurrentSubscriptionUseCase, (c) => {
    return new GetCurrentSubscriptionUseCase(
      c.resolve(SUBSCRIPTION_TOKENS.SubscriptionRepository) as ISubscriptionRepository,
      c.resolve(SUBSCRIPTION_TOKENS.PlanRepository) as IPlanRepository,
    );
  });
  container.register(SUBSCRIPTION_TOKENS.ListPlansUseCase, (c) => {
    return new ListPlansUseCase(c.resolve(SUBSCRIPTION_TOKENS.PlanRepository) as IPlanRepository);
  });
  container.register(SUBSCRIPTION_TOKENS.UpgradeSubscriptionUseCase, (c) => {
    return new UpgradeSubscriptionUseCase(
      c.resolve(SUBSCRIPTION_TOKENS.SubscriptionRepository) as ISubscriptionRepository,
      c.resolve(SUBSCRIPTION_TOKENS.PlanRepository) as IPlanRepository,
    );
  });

  return container;
}

/**
 * Registers the Products module: Prisma-backed repositories + the catalogue use
 * cases (task 13.2).
 *
 * **Client choice:** unlike auth/authorization, product and category data are
 * tenant-owned, so the repositories are bound to the tenant-aware
 * `tenantPrisma` client. It auto-injects the active tenant into every query;
 * the repositories also pass `tenantId` explicitly where the port provides it,
 * for defence-in-depth (Requirement 1.5). The use cases are wired from the
 * repositories registered here so the presentation layer (task 13.3) resolves
 * ready-to-use application services.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerProductInfrastructure(container: Container): Container {
  // Query-result caching (task 39.4, Requirement 26.1) injects the cross-cutting
  // Cache into the list/search reads (populate) and the create/update/delete
  // mutations (invalidate). Ensure the default cache exists so this module can be
  // wired in isolation (e.g. in tests) that did not call registerInfrastructure.
  if (!container.has(INFRASTRUCTURE_TOKENS.Cache)) {
    container.registerValue(INFRASTRUCTURE_TOKENS.Cache, new InMemoryCache());
  }
  container.register(
    PRODUCT_TOKENS.ProductRepository,
    () => new PrismaProductRepository(tenantPrisma as unknown as ProductPrismaClient),
  );
  container.register(
    PRODUCT_TOKENS.CategoryRepository,
    () => new PrismaCategoryRepository(tenantPrisma as unknown as CategoryPrismaClient),
  );

  container.register(PRODUCT_TOKENS.CreateProductUseCase, (c) => {
    return new CreateProductUseCase(
      c.resolve(PRODUCT_TOKENS.ProductRepository) as IProductRepository,
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(PRODUCT_TOKENS.UpdateProductUseCase, (c) => {
    return new UpdateProductUseCase(
      c.resolve(PRODUCT_TOKENS.ProductRepository) as IProductRepository,
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(PRODUCT_TOKENS.DeleteProductUseCase, (c) => {
    return new DeleteProductUseCase(
      c.resolve(PRODUCT_TOKENS.ProductRepository) as IProductRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(PRODUCT_TOKENS.GetProductUseCase, (c) => {
    return new GetProductUseCase(c.resolve(PRODUCT_TOKENS.ProductRepository) as IProductRepository);
  });
  container.register(PRODUCT_TOKENS.ListProductsUseCase, (c) => {
    return new ListProductsUseCase(
      c.resolve(PRODUCT_TOKENS.ProductRepository) as IProductRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(PRODUCT_TOKENS.SearchProductsUseCase, (c) => {
    return new SearchProductsUseCase(
      c.resolve(PRODUCT_TOKENS.ProductRepository) as IProductRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });

  // Category use cases (task 13.4).
  container.register(PRODUCT_TOKENS.CreateCategoryUseCase, (c) => {
    return new CreateCategoryUseCase(
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
    );
  });
  container.register(PRODUCT_TOKENS.UpdateCategoryUseCase, (c) => {
    return new UpdateCategoryUseCase(
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
    );
  });
  container.register(PRODUCT_TOKENS.DeleteCategoryUseCase, (c) => {
    return new DeleteCategoryUseCase(
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
      c.resolve(PRODUCT_TOKENS.ProductRepository) as IProductRepository,
    );
  });
  container.register(PRODUCT_TOKENS.GetCategoryUseCase, (c) => {
    return new GetCategoryUseCase(
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
    );
  });
  container.register(PRODUCT_TOKENS.ListCategoriesUseCase, (c) => {
    return new ListCategoriesUseCase(
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
    );
  });
  container.register(PRODUCT_TOKENS.GetCategoryTreeUseCase, (c) => {
    return new GetCategoryTreeUseCase(
      c.resolve(PRODUCT_TOKENS.CategoryRepository) as ICategoryRepository,
    );
  });

  return container;
}

/**
 * Registers the Stock module: Prisma-backed repositories, the transactional
 * unit of work and the inventory use cases (task 15.1).
 *
 * **Client choice:** stock and movement data are tenant-owned, so the
 * repositories and unit of work are bound to the tenant-aware `tenantPrisma`
 * client, which auto-injects the active tenant. The repositories also apply
 * `tenantId` explicitly for defence-in-depth (Requirement 1.5).
 * `AdjustStockUseCase` depends on the {@link IStockUnitOfWork} so the balance
 * update and its audit movement are written atomically; `GetStockLevelsUseCase`
 * reads through the stock repository (with low-stock joins on `Product`).
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerStockInfrastructure(container: Container): Container {
  container.register(
    STOCK_TOKENS.StockRepository,
    () => new PrismaStockRepository(tenantPrisma as unknown as StockPrismaClient),
  );
  container.register(
    STOCK_TOKENS.StockMovementRepository,
    () => new PrismaStockMovementRepository(tenantPrisma as unknown as StockMovementPrismaClient),
  );
  container.register(
    STOCK_TOKENS.StockUnitOfWork,
    () => new PrismaStockUnitOfWork(tenantPrisma as unknown as TransactionalPrismaClient),
  );

  container.register(STOCK_TOKENS.AdjustStockUseCase, (c) => {
    return new AdjustStockUseCase(c.resolve(STOCK_TOKENS.StockUnitOfWork) as IStockUnitOfWork);
  });
  container.register(STOCK_TOKENS.GetStockLevelsUseCase, (c) => {
    return new GetStockLevelsUseCase(c.resolve(STOCK_TOKENS.StockRepository) as IStockRepository);
  });

  // RecordStockMovementUseCase composes AdjustStockUseCase's atomic write path
  // (it does not duplicate the balance + movement transaction) and requires a
  // document reference — it is the API the event handlers drive (task 15.2).
  container.register(STOCK_TOKENS.RecordStockMovementUseCase, (c) => {
    return new RecordStockMovementUseCase(
      c.resolve(STOCK_TOKENS.AdjustStockUseCase) as AdjustStockUseCase,
    );
  });
  container.register(STOCK_TOKENS.GetStockMovementHistoryUseCase, (c) => {
    return new GetStockMovementHistoryUseCase(
      c.resolve(STOCK_TOKENS.StockMovementRepository) as IStockMovementRepository,
    );
  });
  // The Prisma movement repository also implements IStockMovementCursorReader,
  // so the cursor use case shares the single registered instance (task 39.3).
  container.register(STOCK_TOKENS.ListStockMovementsByCursorUseCase, (c) => {
    return new ListStockMovementsByCursorUseCase(
      c.resolve(STOCK_TOKENS.StockMovementRepository) as unknown as IStockMovementCursorReader,
    );
  });
  container.register(STOCK_TOKENS.StockEventHandlers, (c) => {
    return new StockEventHandlers(
      c.resolve(STOCK_TOKENS.RecordStockMovementUseCase) as RecordStockMovementUseCase,
      defaultStockEventLogger,
    );
  });

  return container;
}

/**
 * Registers the Customers module: the Prisma-backed customer repository + the
 * customer use cases (task 17.1).
 *
 * **Client choice:** customer data is tenant-owned, so the repository is bound
 * to the tenant-aware `tenantPrisma` client, which auto-injects the active
 * tenant into every query; the repository also passes `tenantId` explicitly
 * where the port provides it, for defence-in-depth (Requirement 1.5). The use
 * cases are wired from the repository registered here so the presentation layer
 * (task 17.2) resolves ready-to-use application services.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerCustomerInfrastructure(container: Container): Container {
  // Query-result caching (task 39.4, Requirement 26.1) injects the cross-cutting
  // Cache into the list/search reads and the create/update/delete mutations.
  // Ensure the default cache exists so this module can be wired in isolation.
  if (!container.has(INFRASTRUCTURE_TOKENS.Cache)) {
    container.registerValue(INFRASTRUCTURE_TOKENS.Cache, new InMemoryCache());
  }
  container.register(
    CUSTOMER_TOKENS.CustomerRepository,
    () => new PrismaCustomerRepository(tenantPrisma as unknown as CustomerPrismaClient),
  );

  container.register(CUSTOMER_TOKENS.CreateCustomerUseCase, (c) => {
    return new CreateCustomerUseCase(
      c.resolve(CUSTOMER_TOKENS.CustomerRepository) as ICustomerRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(CUSTOMER_TOKENS.UpdateCustomerUseCase, (c) => {
    return new UpdateCustomerUseCase(
      c.resolve(CUSTOMER_TOKENS.CustomerRepository) as ICustomerRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(CUSTOMER_TOKENS.DeleteCustomerUseCase, (c) => {
    return new DeleteCustomerUseCase(
      c.resolve(CUSTOMER_TOKENS.CustomerRepository) as ICustomerRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(CUSTOMER_TOKENS.GetCustomerUseCase, (c) => {
    return new GetCustomerUseCase(
      c.resolve(CUSTOMER_TOKENS.CustomerRepository) as ICustomerRepository,
    );
  });
  container.register(CUSTOMER_TOKENS.ListCustomersUseCase, (c) => {
    return new ListCustomersUseCase(
      c.resolve(CUSTOMER_TOKENS.CustomerRepository) as ICustomerRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(CUSTOMER_TOKENS.SearchCustomersUseCase, (c) => {
    return new SearchCustomersUseCase(
      c.resolve(CUSTOMER_TOKENS.CustomerRepository) as ICustomerRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });

  return container;
}

/**
 * Registers the Suppliers module: the Prisma-backed supplier repository + the
 * supplier use cases (task 17.3).
 *
 * **Client choice:** supplier data is tenant-owned, so the repository is bound
 * to the tenant-aware `tenantPrisma` client, which auto-injects the active
 * tenant into every query; the repository also passes `tenantId` explicitly
 * where the port provides it, for defence-in-depth (Requirement 1.5). The use
 * cases are wired from the repository registered here so the presentation layer
 * resolves ready-to-use application services. Mirrors
 * {@link registerCustomerInfrastructure}.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerSupplierInfrastructure(container: Container): Container {
  container.register(
    SUPPLIER_TOKENS.SupplierRepository,
    () => new PrismaSupplierRepository(tenantPrisma as unknown as SupplierPrismaClient),
  );

  container.register(SUPPLIER_TOKENS.CreateSupplierUseCase, (c) => {
    return new CreateSupplierUseCase(
      c.resolve(SUPPLIER_TOKENS.SupplierRepository) as ISupplierRepository,
    );
  });
  container.register(SUPPLIER_TOKENS.UpdateSupplierUseCase, (c) => {
    return new UpdateSupplierUseCase(
      c.resolve(SUPPLIER_TOKENS.SupplierRepository) as ISupplierRepository,
    );
  });
  container.register(SUPPLIER_TOKENS.DeleteSupplierUseCase, (c) => {
    return new DeleteSupplierUseCase(
      c.resolve(SUPPLIER_TOKENS.SupplierRepository) as ISupplierRepository,
    );
  });
  container.register(SUPPLIER_TOKENS.GetSupplierUseCase, (c) => {
    return new GetSupplierUseCase(
      c.resolve(SUPPLIER_TOKENS.SupplierRepository) as ISupplierRepository,
    );
  });
  container.register(SUPPLIER_TOKENS.ListSuppliersUseCase, (c) => {
    return new ListSuppliersUseCase(
      c.resolve(SUPPLIER_TOKENS.SupplierRepository) as ISupplierRepository,
    );
  });
  container.register(SUPPLIER_TOKENS.SearchSuppliersUseCase, (c) => {
    return new SearchSuppliersUseCase(
      c.resolve(SUPPLIER_TOKENS.SupplierRepository) as ISupplierRepository,
    );
  });

  return container;
}

/**
 * Registers the Sales module: the Prisma-backed sale repository, the
 * transactional unit of work, the product-pricing + customer-existence reader
 * ports and the {@link CreateSaleUseCase} (task 19.1).
 *
 * **Client choice:** sales data is tenant-owned, so every repository/reader is
 * bound to the tenant-aware `tenantPrisma` client, which auto-injects the active
 * tenant; each also applies `tenantId` explicitly for defence-in-depth
 * (Requirement 1.5). `CreateSaleUseCase` depends on the {@link ISaleUnitOfWork}
 * so the sale-number allocation and the header/line insert commit atomically,
 * and on the reader ports so pricing/customer validation read from the
 * catalogue source of truth without crossing module boundaries.
 *
 * `CreateSaleUseCase` is also given the application {@link IEventBus} so it can
 * publish the buffered `SaleCompleted` event after the sale commits (task 19.2);
 * the Stock module's consumer (wired via {@link wireStockEventSubscriptions})
 * reacts by decrementing inventory. The bus is registered by
 * {@link registerInfrastructure}, which must run first.
 *
 * Also binds the read/update/delete use cases (task 19.3): {@link GetSaleUseCase},
 * {@link ListSalesUseCase}, {@link UpdateSaleStatusUseCase} (given the event bus
 * so completing a draft through the status endpoint publishes `SaleCompleted`
 * like creation does) and {@link DeleteSaleUseCase}. The HTTP routes are mounted
 * by {@link registerSaleRoutes} in the server bootstrap.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerSalesInfrastructure(container: Container): Container {
  container.register(
    SALES_TOKENS.SaleRepository,
    () => new PrismaSaleRepository(tenantPrisma as unknown as SalePrismaClient),
  );
  container.register(
    SALES_TOKENS.SaleUnitOfWork,
    () => new PrismaSaleUnitOfWork(tenantPrisma as unknown as SaleTransactionalPrismaClient),
  );
  container.register(
    SALES_TOKENS.SaleProductReader,
    () => new PrismaSaleProductReader(tenantPrisma as unknown as SaleProductReaderPrismaClient),
  );
  container.register(
    SALES_TOKENS.SaleCustomerReader,
    () => new PrismaSaleCustomerReader(tenantPrisma as unknown as SaleCustomerReaderPrismaClient),
  );

  container.register(SALES_TOKENS.CreateSaleUseCase, (c) => {
    return new CreateSaleUseCase(
      c.resolve(SALES_TOKENS.SaleUnitOfWork) as ISaleUnitOfWork,
      c.resolve(SALES_TOKENS.SaleProductReader) as ISaleProductReader,
      c.resolve(SALES_TOKENS.SaleCustomerReader) as ISaleCustomerReader,
      c.resolve(INFRASTRUCTURE_TOKENS.EventBus) as IEventBus,
    );
  });
  container.register(SALES_TOKENS.GetSaleUseCase, (c) => {
    return new GetSaleUseCase(c.resolve(SALES_TOKENS.SaleRepository) as ISaleRepository);
  });
  container.register(SALES_TOKENS.ListSalesUseCase, (c) => {
    return new ListSalesUseCase(c.resolve(SALES_TOKENS.SaleRepository) as ISaleRepository);
  });
  container.register(SALES_TOKENS.UpdateSaleStatusUseCase, (c) => {
    return new UpdateSaleStatusUseCase(
      c.resolve(SALES_TOKENS.SaleRepository) as ISaleRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.EventBus) as IEventBus,
    );
  });
  container.register(SALES_TOKENS.DeleteSaleUseCase, (c) => {
    return new DeleteSaleUseCase(c.resolve(SALES_TOKENS.SaleRepository) as ISaleRepository);
  });

  return container;
}

/**
 * Registers the Purchases module's ports and application use case (task 21.1).
 *
 * Binds the Prisma-backed {@link PrismaPurchaseRepository} and {@link
 * PrismaPurchaseUnitOfWork} onto the tenant-aware `tenantPrisma` client (so
 * numbering + header/line inserts share one commit) and the reader ports
 * ({@link PrismaPurchaseProductReader}, {@link PrismaPurchaseSupplierReader}) so
 * cost/supplier validation read from the catalogue source of truth without
 * crossing module boundaries.
 *
 * `CreatePurchaseUseCase` is given the application {@link IEventBus} so it can
 * publish the buffered `PurchaseCompleted` event after the purchase commits; the
 * Stock module's consumer (wired via {@link wireStockEventSubscriptions}) reacts
 * by **incrementing** inventory (task 21.2). The bus is registered by
 * {@link registerInfrastructure}, which must run first. HTTP routes are mounted
 * in task 21.3.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerPurchaseInfrastructure(container: Container): Container {
  container.register(
    PURCHASE_TOKENS.PurchaseRepository,
    () => new PrismaPurchaseRepository(tenantPrisma as unknown as PurchasePrismaClient),
  );
  container.register(
    PURCHASE_TOKENS.PurchaseUnitOfWork,
    () =>
      new PrismaPurchaseUnitOfWork(tenantPrisma as unknown as PurchaseTransactionalPrismaClient),
  );
  container.register(
    PURCHASE_TOKENS.PurchaseProductReader,
    () =>
      new PrismaPurchaseProductReader(tenantPrisma as unknown as PurchaseProductReaderPrismaClient),
  );
  container.register(
    PURCHASE_TOKENS.PurchaseSupplierReader,
    () =>
      new PrismaPurchaseSupplierReader(
        tenantPrisma as unknown as PurchaseSupplierReaderPrismaClient,
      ),
  );

  container.register(PURCHASE_TOKENS.CreatePurchaseUseCase, (c) => {
    return new CreatePurchaseUseCase(
      c.resolve(PURCHASE_TOKENS.PurchaseUnitOfWork) as IPurchaseUnitOfWork,
      c.resolve(PURCHASE_TOKENS.PurchaseProductReader) as IPurchaseProductReader,
      c.resolve(PURCHASE_TOKENS.PurchaseSupplierReader) as IPurchaseSupplierReader,
      c.resolve(INFRASTRUCTURE_TOKENS.EventBus) as IEventBus,
    );
  });
  container.register(PURCHASE_TOKENS.GetPurchaseUseCase, (c) => {
    return new GetPurchaseUseCase(
      c.resolve(PURCHASE_TOKENS.PurchaseRepository) as IPurchaseRepository,
    );
  });
  container.register(PURCHASE_TOKENS.ListPurchasesUseCase, (c) => {
    return new ListPurchasesUseCase(
      c.resolve(PURCHASE_TOKENS.PurchaseRepository) as IPurchaseRepository,
    );
  });
  container.register(PURCHASE_TOKENS.UpdatePurchaseStatusUseCase, (c) => {
    return new UpdatePurchaseStatusUseCase(
      c.resolve(PURCHASE_TOKENS.PurchaseRepository) as IPurchaseRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.EventBus) as IEventBus,
    );
  });
  container.register(PURCHASE_TOKENS.DeletePurchaseUseCase, (c) => {
    return new DeletePurchaseUseCase(
      c.resolve(PURCHASE_TOKENS.PurchaseRepository) as IPurchaseRepository,
    );
  });

  return container;
}

/**
 * Registers the Cash module: the Prisma-backed cash-register, movement-ledger
 * and payment repositories, the transactional unit of work and the open/close
 * register use cases (task 23.1).
 *
 * **Client choice:** cash data is tenant-owned, so every repository/unit-of-work
 * is bound to the tenant-aware `tenantPrisma` client, which auto-injects the
 * active tenant; each also applies `tenantId` explicitly for defence-in-depth
 * (Requirement 1.5). {@link OpenCashRegisterUseCase} and
 * {@link CloseCashRegisterUseCase} depend on the {@link ICashUnitOfWork} so the
 * register insert/opening-movement (open) and the reconciliation-movement/
 * balance-update (close) commit atomically; the close use case also reads
 * through the {@link ICashRepository} to load the register.
 *
 * The register lifecycle is modelled through `CashMovement` categories
 * (`opening`/`closing`) — the `Cash` table has no status column.
 *
 * **Payment processing (task 23.2):** also binds the sale/purchase total reader
 * ports (against the `Sale`/`Purchase` tables) and the payment use cases —
 * {@link RecordPaymentUseCase} (rejects overpayment; books a `sale` INCOME /
 * `purchase` EXPENSE movement atomically for cash payments tied to a register),
 * {@link GetPaymentStatusUseCase} (derives unpaid/partial/paid) and
 * {@link ListPaymentsUseCase}. The HTTP routes (task 23.3) are wired later.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerCashInfrastructure(container: Container): Container {
  container.register(
    CASH_TOKENS.CashRepository,
    () => new PrismaCashRepository(tenantPrisma as unknown as CashPrismaClient),
  );
  container.register(
    CASH_TOKENS.CashMovementRepository,
    () => new PrismaCashMovementRepository(tenantPrisma as unknown as CashMovementPrismaClient),
  );
  container.register(
    CASH_TOKENS.PaymentRepository,
    () => new PrismaPaymentRepository(tenantPrisma as unknown as PaymentPrismaClient),
  );
  container.register(
    CASH_TOKENS.CashUnitOfWork,
    () => new PrismaCashUnitOfWork(tenantPrisma as unknown as CashTransactionalPrismaClient),
  );
  container.register(
    CASH_TOKENS.PaymentSaleReader,
    () => new PrismaPaymentSaleReader(tenantPrisma as unknown as PaymentSaleReaderPrismaClient),
  );
  container.register(
    CASH_TOKENS.PaymentPurchaseReader,
    () =>
      new PrismaPaymentPurchaseReader(
        tenantPrisma as unknown as PaymentPurchaseReaderPrismaClient,
      ),
  );

  container.register(CASH_TOKENS.OpenCashRegisterUseCase, (c) => {
    return new OpenCashRegisterUseCase(c.resolve(CASH_TOKENS.CashUnitOfWork) as ICashUnitOfWork);
  });
  container.register(CASH_TOKENS.CloseCashRegisterUseCase, (c) => {
    return new CloseCashRegisterUseCase(
      c.resolve(CASH_TOKENS.CashUnitOfWork) as ICashUnitOfWork,
      c.resolve(CASH_TOKENS.CashRepository) as ICashRepository,
    );
  });
  container.register(CASH_TOKENS.RecordCashMovementUseCase, (c) => {
    return new RecordCashMovementUseCase(
      c.resolve(CASH_TOKENS.CashUnitOfWork) as ICashUnitOfWork,
      c.resolve(CASH_TOKENS.CashRepository) as ICashRepository,
    );
  });
  container.register(CASH_TOKENS.ListCashMovementsUseCase, (c) => {
    return new ListCashMovementsUseCase(
      c.resolve(CASH_TOKENS.CashMovementRepository) as ICashMovementRepository,
    );
  });
  container.register(CASH_TOKENS.RecordPaymentUseCase, (c) => {
    return new RecordPaymentUseCase(
      c.resolve(CASH_TOKENS.PaymentRepository) as IPaymentRepository,
      c.resolve(CASH_TOKENS.CashUnitOfWork) as ICashUnitOfWork,
      c.resolve(CASH_TOKENS.CashRepository) as ICashRepository,
      c.resolve(CASH_TOKENS.PaymentSaleReader) as IPaymentSaleReader,
      c.resolve(CASH_TOKENS.PaymentPurchaseReader) as IPaymentPurchaseReader,
    );
  });
  container.register(CASH_TOKENS.GetPaymentStatusUseCase, (c) => {
    return new GetPaymentStatusUseCase(
      c.resolve(CASH_TOKENS.PaymentRepository) as IPaymentRepository,
      c.resolve(CASH_TOKENS.PaymentSaleReader) as IPaymentSaleReader,
      c.resolve(CASH_TOKENS.PaymentPurchaseReader) as IPaymentPurchaseReader,
    );
  });
  container.register(CASH_TOKENS.ListPaymentsUseCase, (c) => {
    return new ListPaymentsUseCase(c.resolve(CASH_TOKENS.PaymentRepository) as IPaymentRepository);
  });

  return container;
}

/**
 * Registers the Reports module's reader ports and read/aggregation use cases
 * on the container (task 25.1).
 *
 * The readers are bound to the tenant-aware `tenantPrisma` client and aggregate
 * across the shared tables (`Sale`, `Stock`, `CashMovement`, `Customer`,
 * `Product`, `SaleDetail`) — the Reports module never imports the other
 * modules' repositories. The HTTP routes (task 25.3) are wired later, so this
 * only registers the application-facing use cases behind the reader ports.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerReportInfrastructure(container: Container): Container {
  container.register(
    REPORT_TOKENS.SalesReportReader,
    () => new PrismaSalesReportReader(tenantPrisma as unknown as SalesReportPrismaClient),
  );
  container.register(
    REPORT_TOKENS.StockReportReader,
    () => new PrismaStockReportReader(tenantPrisma as unknown as StockReportPrismaClient),
  );
  container.register(
    REPORT_TOKENS.CashFlowReportReader,
    () => new PrismaCashFlowReportReader(tenantPrisma as unknown as CashFlowReportPrismaClient),
  );
  container.register(
    REPORT_TOKENS.CustomerReportReader,
    () => new PrismaCustomerReportReader(tenantPrisma as unknown as CustomerReportPrismaClient),
  );
  container.register(
    REPORT_TOKENS.ProductPerformanceReader,
    () =>
      new PrismaProductPerformanceReader(
        tenantPrisma as unknown as ProductPerformancePrismaClient,
      ),
  );

  container.register(REPORT_TOKENS.SalesReportUseCase, (c) => {
    return new SalesReportUseCase(c.resolve(REPORT_TOKENS.SalesReportReader) as ISalesReportReader);
  });
  container.register(REPORT_TOKENS.StockReportUseCase, (c) => {
    return new StockReportUseCase(c.resolve(REPORT_TOKENS.StockReportReader) as IStockReportReader);
  });
  container.register(REPORT_TOKENS.CashFlowReportUseCase, (c) => {
    return new CashFlowReportUseCase(
      c.resolve(REPORT_TOKENS.CashFlowReportReader) as ICashFlowReportReader,
    );
  });
  container.register(REPORT_TOKENS.CustomerReportUseCase, (c) => {
    return new CustomerReportUseCase(
      c.resolve(REPORT_TOKENS.CustomerReportReader) as ICustomerReportReader,
    );
  });
  container.register(REPORT_TOKENS.ProductPerformanceReportUseCase, (c) => {
    return new ProductPerformanceReportUseCase(
      c.resolve(REPORT_TOKENS.ProductPerformanceReader) as IProductPerformanceReader,
    );
  });

  return container;
}

/**
 * Registers the Administration module: tenant + configuration repositories and
 * the tenant-management use cases (task 27.1).
 *
 * **Client choice:** the tenant repository is bound to the UNEXTENDED
 * `systemPrisma` client because the `Tenant` model is the multi-tenancy ROOT and
 * is not itself tenant-scoped — the tenant auto-filter has no tenant to inject
 * during provisioning and would break creating/reading a tenant. The
 * configuration repository is bound to the tenant-aware `tenantPrisma` client
 * (configurations carry `tenantId`); it also applies `tenantId` explicitly so it
 * works during provisioning, when no request/tenant context exists yet
 * (Requirement 1.5).
 *
 * `CreateTenantUseCase` reuses the Authorization module's idempotent
 * {@link SeedSystemRolesUseCase} through the `ITenantRoleSeeder` port to seed the
 * default Admin/Manager/User roles + permission matrix for the new tenant
 * (Requirement 28.5). The seeder is built from the role repository — the
 * Authorization infrastructure is registered lazily here if a caller-supplied
 * (test) container has not already wired it — bound to `systemPrisma` so it can
 * write roles before a tenant request context exists.
 *
 * HTTP routes (task 27.2) and branding asset upload to cloud storage (task 27.3)
 * are NOT wired here.
 *
 * @param container - The container to populate.
 * @returns The same container, to allow fluent composition.
 */
export function registerAdministrationInfrastructure(container: Container): Container {
  container.register(
    ADMINISTRATION_TOKENS.TenantRepository,
    () => new PrismaTenantRepository(systemPrisma as unknown as TenantPrismaClient),
  );
  container.register(
    ADMINISTRATION_TOKENS.ConfigurationRepository,
    () => new PrismaConfigurationRepository(tenantPrisma as unknown as ConfigurationPrismaClient),
  );
  // Read-only audit-log reader (task 27.2). Bound to the tenant-aware client so
  // queries are automatically tenant-filtered; the repository also scopes by
  // `tenantId` explicitly for defence-in-depth (Requirement 1.5).
  container.register(
    ADMINISTRATION_TOKENS.AuditLogRepository,
    () => new PrismaAuditLogRepository(tenantPrisma as unknown as AuditLogPrismaClient),
  );

  // Reuse the Authorization role seeder for provisioning. Ensure a role
  // repository (systemPrisma-bound) is available first.
  if (!container.has(AUTHORIZATION_TOKENS.RoleRepository)) {
    registerAuthorizationInfrastructure(container);
  }

  container.register(ADMINISTRATION_TOKENS.CreateTenantUseCase, (c) => {
    const roleSeeder = new SeedSystemRolesUseCase(
      c.resolve(AUTHORIZATION_TOKENS.RoleRepository) as IRoleRepository,
    );
    return new CreateTenantUseCase(
      c.resolve(ADMINISTRATION_TOKENS.TenantRepository) as ITenantRepository,
      roleSeeder,
      c.resolve(ADMINISTRATION_TOKENS.ConfigurationRepository) as IConfigurationRepository,
    );
  });
  container.register(ADMINISTRATION_TOKENS.UpdateTenantBrandingUseCase, (c) => {
    return new UpdateTenantBrandingUseCase(
      c.resolve(ADMINISTRATION_TOKENS.TenantRepository) as ITenantRepository,
    );
  });

  // Branding customization (task 27.3): logo upload via the storage port +
  // cache-aside reads and write-through invalidation via the cache port. Ensure
  // the cross-cutting cache + storage defaults exist (a caller may have wired
  // only the administration tokens, e.g. in tests).
  if (!container.has(INFRASTRUCTURE_TOKENS.Cache)) {
    container.registerValue(INFRASTRUCTURE_TOKENS.Cache, new InMemoryCache());
  }
  if (!container.has(INFRASTRUCTURE_TOKENS.StorageService)) {
    container.registerValue(INFRASTRUCTURE_TOKENS.StorageService, new StubStorageService());
  }
  container.register(ADMINISTRATION_TOKENS.UpdateBrandingUseCase, (c) => {
    return new UpdateBrandingUseCase(
      c.resolve(ADMINISTRATION_TOKENS.TenantRepository) as ITenantRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.StorageService) as IStorageService,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(ADMINISTRATION_TOKENS.GetBrandingUseCase, (c) => {
    return new GetBrandingUseCase(
      c.resolve(ADMINISTRATION_TOKENS.TenantRepository) as ITenantRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(ADMINISTRATION_TOKENS.SetConfigurationUseCase, (c) => {
    return new SetConfigurationUseCase(
      c.resolve(ADMINISTRATION_TOKENS.ConfigurationRepository) as IConfigurationRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(ADMINISTRATION_TOKENS.GetConfigurationUseCase, (c) => {
    return new GetConfigurationUseCase(
      c.resolve(ADMINISTRATION_TOKENS.ConfigurationRepository) as IConfigurationRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });
  container.register(ADMINISTRATION_TOKENS.ListConfigurationsUseCase, (c) => {
    return new ListConfigurationsUseCase(
      c.resolve(ADMINISTRATION_TOKENS.ConfigurationRepository) as IConfigurationRepository,
      c.resolve(INFRASTRUCTURE_TOKENS.Cache) as ICache,
    );
  });

  return container;
}

/**
 * Wires the Stock module's event consumers onto the application event bus:
 * `SaleCompleted` → stock decrement, `PurchaseCompleted` → stock increment
 * (design "Event-Driven Communication", task 15.2).
 *
 * The producer side (Sales task 19.2, Purchases task 21.2) will publish these
 * events; here the consumer subscriptions are registered so those tasks only
 * need to publish. Call this once at bootstrap AFTER
 * {@link registerInfrastructure} (which registers the bus) and
 * {@link registerStockInfrastructure}.
 *
 * @param container - The composed container (event bus + stock use cases).
 * @returns A disposer that removes the subscriptions (graceful shutdown/tests).
 */
export function wireStockEventSubscriptions(container: Container): () => void {
  const bus = container.resolve(INFRASTRUCTURE_TOKENS.EventBus) as IEventBus;
  const handlers = container.resolve(STOCK_TOKENS.StockEventHandlers) as StockEventHandlers;
  return handlers.register(bus);
}

/**
 * Fallback stock event logger used until bootstrap injects the application's
 * pino logger. Emits to `console` so an insufficient-stock-on-sale warning
 * (which requires manual reconciliation) is never silently dropped.
 */
const defaultStockEventLogger: StockEventLogger = {
  warn(context, message) {
    console.warn(JSON.stringify({ level: 'warn', msg: message, ...context }));
  },
  error(context, message) {
    console.error(JSON.stringify({ level: 'error', msg: message, ...context }));
  },
};

/**
 * Fallback structured logger used when bootstrap does not inject the
 * application's pino logger. Emits to `console` so authentication audit events
 * (Requirement 17.7) are never silently dropped; the server bootstrap (and
 * task 8.4 route wiring) should pass the Fastify `app.log` instance instead.
 */
const defaultStructuredLogger: StructuredLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- fallback audit sink before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
};

/**
 * Fallback crash-reporter logger used for the DI default reporter (task 33.3)
 * when bootstrap does not inject the application's pino logger. Emits to
 * `console.error` so a crash report is never silently dropped before pino is
 * wired; the server bootstrap constructs an `app.log`-bound reporter for the
 * request-path error handler.
 */
const defaultCrashLogger: CrashReporterLogger = {
  error(obj, msg) {
    console.error(JSON.stringify({ level: 'error', msg, ...obj }));
  },
};

/**
 * Fallback Remote Config logger used for the DI default service (task 33.5)
 * when bootstrap does not inject the application's pino logger. Emits to
 * `console.warn` so a Remote Config fetch failure (after which the service falls
 * back to local defaults) is never silently dropped before pino is wired.
 */
const defaultRemoteConfigLogger: RemoteConfigLogger = {
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
};

/**
 * Fallback plugin logger used for the DI default {@link PluginLoader} /
 * {@link PluginActivationService} (task 35.2) when bootstrap does not inject the
 * application's pino logger. Emits to `console` so a plugin lifecycle event or a
 * graceful-degradation failure (Requirement 19.5) is never silently dropped
 * before pino is wired; boot code should pass the Fastify `app.log` instead.
 */
const defaultPluginLogger: PluginLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- fallback plugin sink before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
  error(obj, msg) {
    console.error(JSON.stringify({ level: 'error', msg, ...obj }));
  },
};

/**
 * Fallback logger for the DI default {@link ResilientAIService} cost-tracking
 * sink (task 37.2, Requirement 20.6) when bootstrap does not inject the
 * application's pino logger. Emits each `event: 'ai_interaction'` line to
 * `console` so cost/usage accounting is never silently dropped before pino is
 * wired; boot code should pass the Fastify `app.log` instead. With no providers
 * configured (the default) this only records `outcome: 'unavailable'` lines.
 */
const defaultAiInteractionLogger: AIInteractionLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- fallback AI cost sink before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
};

/**
 * Deny-all fallback for the {@link PluginActivationService} used only when the
 * Subscriptions feature-access service is not registered (task 35.2,
 * Requirement 19.6). It grants no tenant any plugin — the safe default — and
 * never throws. In normal bootstrap `registerSubscriptionInfrastructure(...)`
 * binds the real {@link IFeatureAccessService}, which supersedes this.
 */
const denyAllFeatureAccess: PluginFeatureAccess = {
  isFeatureEnabled: async () => false,
};
