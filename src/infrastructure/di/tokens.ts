import type { PrismaClient } from '@prisma/client';
import type {
  ITokenService,
  IUserRepository,
  IRefreshTokenRepository,
  IAuthEventLogger,
} from '@modules/auth/index.js';
import type { IRoleRepository } from '@modules/authorization/index.js';
import type {
  IFeatureAccessService,
  IPlanRepository,
  ISubscriptionRepository,
  CreateSubscriptionUseCase,
  CheckFeatureAccessUseCase,
  SeedPlansUseCase,
  GetCurrentSubscriptionUseCase,
  ListPlansUseCase,
  UpgradeSubscriptionUseCase,
} from '@modules/subscriptions/index.js';
import type {
  IProductRepository,
  ICategoryRepository,
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
} from '@modules/products/index.js';
import type {
  IStockRepository,
  IStockMovementRepository,
  IStockUnitOfWork,
  AdjustStockUseCase,
  GetStockLevelsUseCase,
  RecordStockMovementUseCase,
  GetStockMovementHistoryUseCase,
  ListStockMovementsByCursorUseCase,
  StockEventHandlers,
} from '@modules/stock/index.js';
import type {
  ICustomerRepository,
  CreateCustomerUseCase,
  UpdateCustomerUseCase,
  DeleteCustomerUseCase,
  GetCustomerUseCase,
  ListCustomersUseCase,
  SearchCustomersUseCase,
} from '@modules/customers/index.js';
import type {
  ISupplierRepository,
  CreateSupplierUseCase,
  UpdateSupplierUseCase,
  DeleteSupplierUseCase,
  GetSupplierUseCase,
  ListSuppliersUseCase,
  SearchSuppliersUseCase,
} from '@modules/suppliers/index.js';
import type {
  ISaleRepository,
  ISaleUnitOfWork,
  ISaleProductReader,
  ISaleCustomerReader,
  CreateSaleUseCase,
  GetSaleUseCase,
  ListSalesUseCase,
  UpdateSaleStatusUseCase,
  DeleteSaleUseCase,
} from '@modules/sales/index.js';
import type {
  IPurchaseRepository,
  IPurchaseUnitOfWork,
  IPurchaseProductReader,
  IPurchaseSupplierReader,
  CreatePurchaseUseCase,
  GetPurchaseUseCase,
  ListPurchasesUseCase,
  UpdatePurchaseStatusUseCase,
  DeletePurchaseUseCase,
} from '@modules/purchases/index.js';
import type {
  ICashRepository,
  ICashMovementRepository,
  IPaymentRepository,
  ICashUnitOfWork,
  IPaymentSaleReader,
  IPaymentPurchaseReader,
  OpenCashRegisterUseCase,
  CloseCashRegisterUseCase,
  RecordCashMovementUseCase,
  ListCashMovementsUseCase,
  RecordPaymentUseCase,
  GetPaymentStatusUseCase,
  ListPaymentsUseCase,
} from '@modules/cash/index.js';
import type {
  ISalesReportReader,
  IStockReportReader,
  ICashFlowReportReader,
  ICustomerReportReader,
  IProductPerformanceReader,
  SalesReportUseCase,
  StockReportUseCase,
  CashFlowReportUseCase,
  CustomerReportUseCase,
  ProductPerformanceReportUseCase,
} from '@modules/reports/index.js';
import type {
  ITenantRepository,
  IConfigurationRepository,
  IAuditLogRepository,
  CreateTenantUseCase,
  UpdateTenantBrandingUseCase,
  UpdateBrandingUseCase,
  GetBrandingUseCase,
  SetConfigurationUseCase,
  GetConfigurationUseCase,
  ListConfigurationsUseCase,
} from '@modules/administration/index.js';
import type { ICache } from '@application/ports/cache.js';
import type { ISessionStore } from '@application/ports/session-store.js';
import type { IStorageService } from '@application/ports/storage.js';
import type { IEventBus } from '@domain/events/index.js';
import type { IFirebaseAdmin } from '@infrastructure/firebase/index.js';
import type { CacheWarmer } from '@infrastructure/cache/index.js';
import type { IAnalyticsService } from '@common/analytics';
import type { IPerformanceTracer } from '@common/monitoring';
import type { ICrashReporter } from '@common/crash-reporting';
import type { IRemoteConfigService } from '@common/remote-config';
import type {
  PluginRegistry,
  PluginLoader,
  PluginActivationService,
} from '../../plugins/index.js';
import type {
  IAIService,
  ISalesAssistantService,
  IStockPredictionService,
  INaturalLanguageQueryService,
  IReportGenerationService,
  IAutomationSuggestionService,
} from '../../ai/index.js';
import { createToken } from './injection-token.js';

/**
 * Well-known injection tokens for infrastructure-provided dependencies.
 *
 * Application and module code resolves these tokens rather than importing
 * concrete infrastructure directly, preserving the dependency rule
 * (Requirement 3.2).
 */
export const INFRASTRUCTURE_TOKENS = {
  /** The shared {@link PrismaClient} singleton. */
  PrismaClient: createToken<PrismaClient>('PrismaClient'),
  /** In-process event bus for inter-module communication (Requirement 3.5). */
  EventBus: createToken<IEventBus>('EventBus'),
  /**
   * Cross-cutting cache abstraction. Bound to the in-memory implementation
   * today; the Redis-backed implementation (task 39.1) satisfies the same port.
   */
  Cache: createToken<ICache>('Cache'),
  /**
   * Cache warmer for tenant configurations (task 39.2, Requirement 31.4). Bound
   * by default to a {@link CacheWarmer} whose loaders pre-load each tenant's
   * configuration list and branding projection into the {@link Cache} (the
   * multi-level cache) so the first read after a cold start is served from cache
   * rather than the database. Best-effort and never-throws: a failed warm simply
   * defers to lazy cache-aside population. Boot code / provisioning resolves this
   * token to warm known tenants; it is wired as a LAZY factory because its
   * loaders depend on the Administration repositories bound separately.
   */
  CacheWarmer: createToken<CacheWarmer>('CacheWarmer'),
  /**
   * Server-side session storage (task 39.1, Requirement 31.2). Bound to a
   * Redis-backed store when `REDIS_URL` is configured (shared across
   * horizontally-scaled, stateless backend instances) and to an in-process store
   * otherwise. ADDITIVE to the stateless JWT auth — it holds short-lived,
   * server-owned session state (step-up flows, revocation lists, opt-in cookie
   * sessions), not the primary auth path.
   */
  SessionStore: createToken<ISessionStore>('SessionStore'),
  /**
   * Cross-cutting cloud-storage abstraction for branding assets. Bound to the
   * local stub today; the real cloud implementation (task 33.x) satisfies the
   * same port (Requirement 11.3).
   */
  StorageService: createToken<IStorageService>('StorageService'),
  /**
   * Firebase Admin SDK client (task 33.1, Requirements 13.5/14.2). Bound to a
   * no-op {@link IFirebaseAdmin} when no service-account credentials are
   * configured; to a live singleton admin app when they are. Downstream
   * services (Analytics task 33.2, Remote Config task 33.5) resolve this token.
   */
  FirebaseAdmin: createToken<IFirebaseAdmin>('FirebaseAdmin'),
  /**
   * Cross-cutting analytics service (task 33.2, Requirements 13.1–13.4). Bound
   * to the {@link StructuredLogAnalyticsService} by default — events are emitted
   * to the structured log stream (a log-based analytics / GA4 export sink). A
   * GA4 Measurement Protocol implementation satisfying the same
   * {@link IAnalyticsService} port can bind here later. Any layer that needs to
   * emit an event resolves this token.
   */
  AnalyticsService: createToken<IAnalyticsService>('AnalyticsService'),
  /**
   * Cross-cutting performance tracer (task 33.4, Requirements 13.7, 21.9). Bound
   * by default to a {@link MetricsPerformanceTracer} backed by the same metrics
   * registry that serves `/metrics`, so backend "custom traces" (named
   * operation timings — the analogue of Firebase Performance custom traces)
   * surface alongside request/DB metrics. A {@link NoopPerformanceTracer}
   * disables tracing. API response times and DB query timing are already
   * tracked by the request hook and the Prisma metrics extension (task 31.3);
   * screen load times are measured client-side (Web/Android/iOS).
   */
  PerformanceTracer: createToken<IPerformanceTracer>('PerformanceTracer'),
  /**
   * Cross-cutting crash / error-reporting seam (task 33.3, Requirements 13.6,
   * 21.8). Bound by default to the {@link StructuredLogCrashReporter} — 5xx and
   * unknown errors are forwarded as `event:'error_report'` log lines that the
   * ops pipeline routes to an external crash tracker. A real server reporter
   * (e.g. Sentry's Node SDK) satisfying the same {@link ICrashReporter} port can
   * bind here later; a {@link NoopCrashReporter} disables reporting. NOTE: the
   * actual Firebase Crashlytics integration is a CLIENT concern (Android
   * task 51.3, iOS task 56.3) — there is no server-side Crashlytics SDK.
   */
  CrashReporter: createToken<ICrashReporter>('CrashReporter'),
  /**
   * Cross-cutting Remote Config service (task 33.5, Requirement 14.7). Bound by
   * default to a {@link FirebaseRemoteConfigService} that reads the server-side
   * Firebase Remote Config template through {@link IFirebaseAdmin} — the source
   * of FEATURE FLAGS and dynamic configuration (Requirement 14.4). Because env
   * alone supplies the Firebase project/credentials, TEST and PRODUCTION
   * deployments read their OWN, separate Remote Config settings automatically
   * (Requirement 14.7). When Firebase is disabled (no credentials — this
   * environment) it degrades to caller-supplied local defaults and NEVER throws,
   * exactly like the {@link StaticRemoteConfigService} no-op. A real
   * Firebase-backed Remote Config source binds to the SAME
   * {@link IRemoteConfigService} port once credentials are provisioned, with no
   * call-site changes. Any layer that needs a flag/config value resolves this
   * token.
   */
  RemoteConfig: createToken<IRemoteConfigService>('RemoteConfig'),
  /**
   * Cross-cutting Plugin System registry (task 35.1, Requirements 19.1/19.4).
   * Bound by default to an empty in-memory {@link PluginRegistry} — the single
   * catalogue of installed plugins, keyed by id and indexed by
   * {@link PluginType}, that keeps external integrations decoupled from domain
   * code (Requirement 19.1) and defines the standard contracts for payment,
   * messaging, e-commerce, reporting and AI plugins (Requirement 19.4). This
   * task registers only the catalogue; task 35.2 builds plugin
   * loading/discovery and per-tenant activation ON TOP of the resolved
   * registry, and task 35.3 adds concrete external-service adapters — all
   * without call-site changes. Any layer that needs to register or resolve a
   * plugin resolves this token.
   */
  PluginRegistry: createToken<PluginRegistry>('PluginRegistry'),
  /**
   * Plugin loader/discovery (task 35.2, Requirements 19.3/19.5). Bound by
   * default to a {@link PluginLoader} over the resolved {@link PluginRegistry}
   * that discovers plugins from an EXPLICIT, injectable list of factories
   * (deterministic — no filesystem scan / dynamic import), registers each and
   * drives it through `initialize`→`activate` with graceful degradation (one
   * failing plugin never crashes boot). A real filesystem/npm discovery source
   * plugs in behind the same factory seam later. Boot code resolves this token
   * to load the platform's plugins; task 35.3 supplies the concrete factories.
   */
  PluginLoader: createToken<PluginLoader>('PluginLoader'),
  /**
   * Per-tenant plugin activation (task 35.2, Requirement 19.6). Bound by
   * default to a {@link PluginActivationService} that decides whether a loaded
   * plugin is active for a tenant via the EXISTING feature-access mechanism
   * (the same `IFeatureAccessService` behind `app.requireFeature`), reusing
   * plan + per-tenant feature-flag resolution rather than duplicating it, and
   * toggles the plugin lifecycle per tenant with graceful degradation. Callers
   * that gate an integration on a tenant's flags resolve this token.
   */
  PluginActivationService: createToken<PluginActivationService>('PluginActivationService'),
  /**
   * AI Integration Layer — base capability port (task 37.1, Requirements
   * 20.1/20.3/20.4). The application-facing {@link IAIService} abstraction the
   * use-case layer resolves for AI features, sitting ABOVE the plugin `AIPlugin`
   * providers (OpenAI/Claude/Gemini). It makes the per-operation timeout budget
   * first-class (queries 10s, reports 30s, predictions 60s — Requirement 20.4)
   * and never leaks a vendor SDK into the domain (Requirement 20.3). NO concrete
   * implementation is bound yet: task 37.2 binds a RESILIENT WRAPPER here that
   * composes the plugin providers, enforces the timeouts, degrades gracefully
   * when no provider is available (Requirement 20.5) and logs usage for cost
   * tracking (Requirement 20.6); task 37.3 exposes the endpoints, gated to the
   * Enterprise plan via the existing feature-access mechanism.
   */
  AIService: createToken<IAIService>('AIService'),
  /**
   * AI Sales Assistant capability (task 37.1, Requirement 20.1). Conversational,
   * tenant-scoped sales assistance using the query timeout budget
   * (Requirement 20.4). Bound by task 37.2 over the resilient {@link IAIService};
   * token-only here.
   */
  AISalesAssistant: createToken<ISalesAssistantService>('AI.SalesAssistant'),
  /**
   * AI Stock/Demand Prediction capability (task 37.1, Requirement 20.1). Uses
   * the prediction timeout budget (60s, Requirement 20.4). Bound by task 37.2;
   * token-only here.
   */
  AIStockPrediction: createToken<IStockPredictionService>('AI.StockPrediction'),
  /**
   * AI Natural-Language Query capability (task 37.1, Requirement 20.1).
   * Translates a plain-language question into a tenant-scoped answer using the
   * query timeout budget (Requirement 20.4); the actual data access is out of
   * scope for 37.1. Bound by task 37.2; token-only here.
   */
  AINaturalLanguageQuery: createToken<INaturalLanguageQueryService>('AI.NaturalLanguageQuery'),
  /**
   * AI Report-Generation capability (task 37.1, Requirement 20.1). Uses the
   * report timeout budget (30s, Requirement 20.4). Bound by task 37.2;
   * token-only here.
   */
  AIReportGeneration: createToken<IReportGenerationService>('AI.ReportGeneration'),
  /**
   * AI Automation-Suggestion capability (task 37.1, Requirement 20.1). Suggests
   * automations from tenant activity using the query timeout budget
   * (Requirement 20.4). Bound by task 37.2; token-only here.
   */
  AIAutomationSuggestion: createToken<IAutomationSuggestionService>('AI.AutomationSuggestion'),
} as const;

/**
 * Injection tokens for the Authentication module's ports, bound to their
 * concrete implementations in the composition root (task 8.2).
 */
export const AUTH_TOKENS = {
  /** RS256 JWT access tokens + opaque refresh tokens. */
  TokenService: createToken<ITokenService>('Auth.TokenService'),
  /** Prisma-backed user persistence. */
  UserRepository: createToken<IUserRepository>('Auth.UserRepository'),
  /** Prisma-backed refresh-token persistence. */
  RefreshTokenRepository: createToken<IRefreshTokenRepository>('Auth.RefreshTokenRepository'),
  /** Structured logger for authentication audit events (Requirement 17.7). */
  AuthEventLogger: createToken<IAuthEventLogger>('Auth.AuthEventLogger'),
} as const;

/**
 * Injection tokens for the Authorization (RBAC) module's ports, bound to their
 * concrete implementations in the composition root (task 9.1).
 */
export const AUTHORIZATION_TOKENS = {
  /** Prisma-backed role + permission persistence. */
  RoleRepository: createToken<IRoleRepository>('Authorization.RoleRepository'),
} as const;

/**
 * Injection tokens for the Subscriptions module's ports, bound to their
 * concrete implementations in the composition root (task 9.3).
 */
export const SUBSCRIPTION_TOKENS = {
  /** Resolves tenant feature access from subscription plan + feature flags. */
  FeatureAccessService: createToken<IFeatureAccessService>('Subscriptions.FeatureAccessService'),
  /** Prisma-backed plan catalogue persistence (global — systemPrisma). */
  PlanRepository: createToken<IPlanRepository>('Subscriptions.PlanRepository'),
  /** Prisma-backed subscription persistence (tenant-scoped). */
  SubscriptionRepository: createToken<ISubscriptionRepository>(
    'Subscriptions.SubscriptionRepository',
  ),
  /** Subscribes a tenant to a plan (supersedes any prior active subscription). */
  CreateSubscriptionUseCase: createToken<CreateSubscriptionUseCase>(
    'Subscriptions.CreateSubscriptionUseCase',
  ),
  /** Resolves whether a tenant may access a feature (delegates to FeatureAccessService). */
  CheckFeatureAccessUseCase: createToken<CheckFeatureAccessUseCase>(
    'Subscriptions.CheckFeatureAccessUseCase',
  ),
  /** Seeds the initial Starter/Business/Enterprise plan catalogue (idempotent, global). */
  SeedPlansUseCase: createToken<SeedPlansUseCase>('Subscriptions.SeedPlansUseCase'),
  /** Resolves the caller tenant's current active subscription + plan. */
  GetCurrentSubscriptionUseCase: createToken<GetCurrentSubscriptionUseCase>(
    'Subscriptions.GetCurrentSubscriptionUseCase',
  ),
  /** Lists the active plans available for subscription (public catalogue). */
  ListPlansUseCase: createToken<ListPlansUseCase>('Subscriptions.ListPlansUseCase'),
  /** Switches a tenant to a different plan (supersede, history-preserving). */
  UpgradeSubscriptionUseCase: createToken<UpgradeSubscriptionUseCase>(
    'Subscriptions.UpgradeSubscriptionUseCase',
  ),
} as const;

/**
 * Injection tokens for the Products module's ports and application use cases,
 * bound to their concrete implementations in the composition root (task 13.2).
 */
export const PRODUCT_TOKENS = {
  /** Prisma-backed product persistence (tenant-scoped). */
  ProductRepository: createToken<IProductRepository>('Products.ProductRepository'),
  /** Prisma-backed category persistence (tenant-scoped). */
  CategoryRepository: createToken<ICategoryRepository>('Products.CategoryRepository'),
  /** Creates a product with SKU-uniqueness + category-existence checks. */
  CreateProductUseCase: createToken<CreateProductUseCase>('Products.CreateProductUseCase'),
  /** Updates a product, re-validating invariants and SKU uniqueness. */
  UpdateProductUseCase: createToken<UpdateProductUseCase>('Products.UpdateProductUseCase'),
  /** Soft-deletes a product. */
  DeleteProductUseCase: createToken<DeleteProductUseCase>('Products.DeleteProductUseCase'),
  /** Reads a single product by id (tenant-scoped, 404 when missing). */
  GetProductUseCase: createToken<GetProductUseCase>('Products.GetProductUseCase'),
  /** Lists products with pagination, filtering and sorting. */
  ListProductsUseCase: createToken<ListProductsUseCase>('Products.ListProductsUseCase'),
  /** Searches products by name/SKU substring with pagination. */
  SearchProductsUseCase: createToken<SearchProductsUseCase>('Products.SearchProductsUseCase'),
  /** Creates a category with parent-existence + sibling-name-uniqueness checks. */
  CreateCategoryUseCase: createToken<CreateCategoryUseCase>('Products.CreateCategoryUseCase'),
  /** Updates a category (rename/reparent) with multi-level cycle prevention. */
  UpdateCategoryUseCase: createToken<UpdateCategoryUseCase>('Products.UpdateCategoryUseCase'),
  /** Soft-deletes a category (rejected when it has children or products). */
  DeleteCategoryUseCase: createToken<DeleteCategoryUseCase>('Products.DeleteCategoryUseCase'),
  /** Reads a single category by id (tenant-scoped, 404 when missing). */
  GetCategoryUseCase: createToken<GetCategoryUseCase>('Products.GetCategoryUseCase'),
  /** Lists categories for a tenant (flat). */
  ListCategoriesUseCase: createToken<ListCategoriesUseCase>('Products.ListCategoriesUseCase'),
  /** Builds the hierarchical category tree for a tenant. */
  GetCategoryTreeUseCase: createToken<GetCategoryTreeUseCase>('Products.GetCategoryTreeUseCase'),
} as const;

/**
 * Injection tokens for the Stock module's ports and application use cases,
 * bound to their concrete implementations in the composition root (task 15.1).
 */
export const STOCK_TOKENS = {
  /** Prisma-backed stock-balance persistence (tenant-scoped). */
  StockRepository: createToken<IStockRepository>('Stock.StockRepository'),
  /** Prisma-backed stock-movement audit persistence (append-only). */
  StockMovementRepository: createToken<IStockMovementRepository>('Stock.StockMovementRepository'),
  /** Transaction boundary for atomic balance + movement writes. */
  StockUnitOfWork: createToken<IStockUnitOfWork>('Stock.StockUnitOfWork'),
  /** Applies a stock movement (IN/OUT/ADJUSTMENT/TRANSFER) and records the audit trail. */
  AdjustStockUseCase: createToken<AdjustStockUseCase>('Stock.AdjustStockUseCase'),
  /** Lists stock levels with pagination and low-stock alerts. */
  GetStockLevelsUseCase: createToken<GetStockLevelsUseCase>('Stock.GetStockLevelsUseCase'),
  /** Applies a referenced single-leg movement (sale/purchase origin) atomically. */
  RecordStockMovementUseCase: createToken<RecordStockMovementUseCase>(
    'Stock.RecordStockMovementUseCase',
  ),
  /** Retrieves the movement audit history with filtering + pagination. */
  GetStockMovementHistoryUseCase: createToken<GetStockMovementHistoryUseCase>(
    'Stock.GetStockMovementHistoryUseCase',
  ),
  /** Retrieves the movement audit history with cursor (keyset) pagination for large datasets. */
  ListStockMovementsByCursorUseCase: createToken<ListStockMovementsByCursorUseCase>(
    'Stock.ListStockMovementsByCursorUseCase',
  ),
  /** Consumer that decrements/increments stock on sale/purchase events. */
  StockEventHandlers: createToken<StockEventHandlers>('Stock.StockEventHandlers'),
} as const;

/**
 * Injection tokens for the Customers module's ports and application use cases,
 * bound to their concrete implementations in the composition root (task 17.1).
 */
export const CUSTOMER_TOKENS = {
  /** Prisma-backed customer persistence (tenant-scoped). */
  CustomerRepository: createToken<ICustomerRepository>('Customers.CustomerRepository'),
  /** Creates a customer with per-tenant email/phone uniqueness checks. */
  CreateCustomerUseCase: createToken<CreateCustomerUseCase>('Customers.CreateCustomerUseCase'),
  /** Updates a customer, re-validating contacts and their uniqueness. */
  UpdateCustomerUseCase: createToken<UpdateCustomerUseCase>('Customers.UpdateCustomerUseCase'),
  /** Soft-deletes a customer. */
  DeleteCustomerUseCase: createToken<DeleteCustomerUseCase>('Customers.DeleteCustomerUseCase'),
  /** Reads a single customer by id (tenant-scoped, 404 when missing). */
  GetCustomerUseCase: createToken<GetCustomerUseCase>('Customers.GetCustomerUseCase'),
  /** Lists customers with pagination, filtering and sorting. */
  ListCustomersUseCase: createToken<ListCustomersUseCase>('Customers.ListCustomersUseCase'),
  /** Searches customers by name/email/phone/taxId substring with pagination. */
  SearchCustomersUseCase: createToken<SearchCustomersUseCase>('Customers.SearchCustomersUseCase'),
} as const;

/**
 * Injection tokens for the Suppliers module's ports and application use cases,
 * bound to their concrete implementations in the composition root (task 17.3).
 */
export const SUPPLIER_TOKENS = {
  /** Prisma-backed supplier persistence (tenant-scoped). */
  SupplierRepository: createToken<ISupplierRepository>('Suppliers.SupplierRepository'),
  /** Creates a supplier with per-tenant email/phone uniqueness checks. */
  CreateSupplierUseCase: createToken<CreateSupplierUseCase>('Suppliers.CreateSupplierUseCase'),
  /** Updates a supplier, re-validating contacts and their uniqueness. */
  UpdateSupplierUseCase: createToken<UpdateSupplierUseCase>('Suppliers.UpdateSupplierUseCase'),
  /** Soft-deletes a supplier. */
  DeleteSupplierUseCase: createToken<DeleteSupplierUseCase>('Suppliers.DeleteSupplierUseCase'),
  /** Reads a single supplier by id (tenant-scoped, 404 when missing). */
  GetSupplierUseCase: createToken<GetSupplierUseCase>('Suppliers.GetSupplierUseCase'),
  /** Lists suppliers with pagination, filtering and sorting. */
  ListSuppliersUseCase: createToken<ListSuppliersUseCase>('Suppliers.ListSuppliersUseCase'),
  /** Searches suppliers by name/email/phone/taxId substring with pagination. */
  SearchSuppliersUseCase: createToken<SearchSuppliersUseCase>('Suppliers.SearchSuppliersUseCase'),
} as const;

/**
 * Injection tokens for the Sales module's ports and application use cases, bound
 * to their concrete implementations in the composition root (task 19.1).
 */
export const SALES_TOKENS = {
  /** Prisma-backed sale + sale-detail persistence (tenant-scoped). */
  SaleRepository: createToken<ISaleRepository>('Sales.SaleRepository'),
  /** Transaction boundary for atomic sale-number allocation + header/line insert. */
  SaleUnitOfWork: createToken<ISaleUnitOfWork>('Sales.SaleUnitOfWork'),
  /** Reads authoritative product pricing (price + tax rate) at sale time. */
  SaleProductReader: createToken<ISaleProductReader>('Sales.SaleProductReader'),
  /** Verifies a customer exists for the tenant before opening a sale. */
  SaleCustomerReader: createToken<ISaleCustomerReader>('Sales.SaleCustomerReader'),
  /** Creates a sale: authoritative pricing, computed totals, atomic persistence. */
  CreateSaleUseCase: createToken<CreateSaleUseCase>('Sales.CreateSaleUseCase'),
  /** Reads a single sale by id (tenant-scoped, 404 when missing) with its lines. */
  GetSaleUseCase: createToken<GetSaleUseCase>('Sales.GetSaleUseCase'),
  /** Lists sales with pagination, date/customer/status filtering and sorting. */
  ListSalesUseCase: createToken<ListSalesUseCase>('Sales.ListSalesUseCase'),
  /** Transitions a sale's status through the state machine (publishing events). */
  UpdateSaleStatusUseCase: createToken<UpdateSaleStatusUseCase>('Sales.UpdateSaleStatusUseCase'),
  /** Soft-deletes a sale. */
  DeleteSaleUseCase: createToken<DeleteSaleUseCase>('Sales.DeleteSaleUseCase'),
} as const;

/**
 * Injection tokens for the Purchases module's ports and application use cases,
 * bound to their concrete implementations in the composition root (task 21.1).
 */
export const PURCHASE_TOKENS = {
  /** Prisma-backed purchase + purchase-detail persistence (tenant-scoped). */
  PurchaseRepository: createToken<IPurchaseRepository>('Purchases.PurchaseRepository'),
  /** Transaction boundary for atomic purchase-number allocation + header/line insert. */
  PurchaseUnitOfWork: createToken<IPurchaseUnitOfWork>('Purchases.PurchaseUnitOfWork'),
  /** Reads authoritative product cost (cost + tax rate) at purchase time. */
  PurchaseProductReader: createToken<IPurchaseProductReader>('Purchases.PurchaseProductReader'),
  /** Verifies a supplier exists for the tenant before opening a purchase. */
  PurchaseSupplierReader: createToken<IPurchaseSupplierReader>('Purchases.PurchaseSupplierReader'),
  /** Creates a purchase: authoritative cost, computed totals, atomic persistence. */
  CreatePurchaseUseCase: createToken<CreatePurchaseUseCase>('Purchases.CreatePurchaseUseCase'),
  /** Reads a single purchase by id (tenant-scoped, 404 when missing) with its lines. */
  GetPurchaseUseCase: createToken<GetPurchaseUseCase>('Purchases.GetPurchaseUseCase'),
  /** Lists purchases with pagination, date/supplier/status filtering and sorting. */
  ListPurchasesUseCase: createToken<ListPurchasesUseCase>('Purchases.ListPurchasesUseCase'),
  /** Transitions a purchase's status through the state machine (publishing events). */
  UpdatePurchaseStatusUseCase: createToken<UpdatePurchaseStatusUseCase>(
    'Purchases.UpdatePurchaseStatusUseCase',
  ),
  /** Soft-deletes a purchase. */
  DeletePurchaseUseCase: createToken<DeletePurchaseUseCase>('Purchases.DeletePurchaseUseCase'),
} as const;

/**
 * Injection tokens for the Cash module's ports and application use cases, bound
 * to their concrete implementations in the composition root (task 23.1).
 *
 * The register open/close lifecycle is modelled via `CashMovement` categories
 * (`opening`/`closing`) rather than a status column; see the Cash module facade
 * for the full modelling rationale. `RecordPaymentUseCase` (task 23.2) and the
 * HTTP routes (task 23.3) are wired in later tasks.
 */
export const CASH_TOKENS = {
  /** Prisma-backed cash-register persistence (tenant-scoped). */
  CashRepository: createToken<ICashRepository>('Cash.CashRepository'),
  /** Prisma-backed append-only cash-movement ledger persistence. */
  CashMovementRepository: createToken<ICashMovementRepository>('Cash.CashMovementRepository'),
  /** Prisma-backed payment persistence (sale/purchase settlement). */
  PaymentRepository: createToken<IPaymentRepository>('Cash.PaymentRepository'),
  /** Transaction boundary for atomic register + movement + payment writes. */
  CashUnitOfWork: createToken<ICashUnitOfWork>('Cash.CashUnitOfWork'),
  /** Reads a sale's authoritative total to compute its outstanding balance. */
  PaymentSaleReader: createToken<IPaymentSaleReader>('Cash.PaymentSaleReader'),
  /** Reads a purchase's authoritative total to compute its outstanding balance. */
  PaymentPurchaseReader: createToken<IPaymentPurchaseReader>('Cash.PaymentPurchaseReader'),
  /** Opens a register: creates it and books the opening float movement atomically. */
  OpenCashRegisterUseCase: createToken<OpenCashRegisterUseCase>('Cash.OpenCashRegisterUseCase'),
  /** Closes a register: reconciles the count vs the ledger and books the difference. */
  CloseCashRegisterUseCase: createToken<CloseCashRegisterUseCase>('Cash.CloseCashRegisterUseCase'),
  /** Records a standalone INCOME/EXPENSE movement against a register (overdraft-guarded). */
  RecordCashMovementUseCase: createToken<RecordCashMovementUseCase>(
    'Cash.RecordCashMovementUseCase',
  ),
  /** Lists cash movements (cash-flow history) with filtering + pagination. */
  ListCashMovementsUseCase: createToken<ListCashMovementsUseCase>('Cash.ListCashMovementsUseCase'),
  /** Records a payment against a sale/purchase (rejecting overpayment, moving cash). */
  RecordPaymentUseCase: createToken<RecordPaymentUseCase>('Cash.RecordPaymentUseCase'),
  /** Derives a sale/purchase payment status (unpaid/partial/paid) + balances. */
  GetPaymentStatusUseCase: createToken<GetPaymentStatusUseCase>('Cash.GetPaymentStatusUseCase'),
  /** Lists payments with filtering (sale/purchase/method/date) + pagination. */
  ListPaymentsUseCase: createToken<ListPaymentsUseCase>('Cash.ListPaymentsUseCase'),
} as const;

/**
 * Injection tokens for the Reports module's reader **output ports** and its
 * read/aggregation use cases, bound to their concrete implementations in the
 * composition root (task 25.1).
 *
 * The Reports module owns no tables: each reader is implemented against the
 * shared Prisma tables (`Sale`, `Stock`, `CashMovement`, `Customer`, `Product`,
 * `SaleDetail`) using aggregation, so the module never imports the
 * Sales/Stock/Cash/Customers/Products internals. The HTTP endpoints + export
 * (task 25.3) and query index optimization (task 25.2) are handled later.
 */
export const REPORT_TOKENS = {
  /** Reads aggregated sales figures (window totals + per-day breakdown). */
  SalesReportReader: createToken<ISalesReportReader>('Reports.SalesReportReader'),
  /** Reads current stock levels + low-stock alerts. */
  StockReportReader: createToken<IStockReportReader>('Reports.StockReportReader'),
  /** Reads cash-flow income/expense sums by category with the net delta. */
  CashFlowReportReader: createToken<ICashFlowReportReader>('Reports.CashFlowReportReader'),
  /** Ranks top customers by total purchased over a window. */
  CustomerReportReader: createToken<ICustomerReportReader>('Reports.CustomerReportReader'),
  /** Ranks best-selling products by quantity sold / revenue over a window. */
  ProductPerformanceReader: createToken<IProductPerformanceReader>(
    'Reports.ProductPerformanceReader',
  ),
  /** Produces a sales report (date-range filtered) from the reader. */
  SalesReportUseCase: createToken<SalesReportUseCase>('Reports.SalesReportUseCase'),
  /** Produces a stock report (levels + low-stock alerts) from the reader. */
  StockReportUseCase: createToken<StockReportUseCase>('Reports.StockReportUseCase'),
  /** Produces a cash-flow report (movement summaries) from the reader. */
  CashFlowReportUseCase: createToken<CashFlowReportUseCase>('Reports.CashFlowReportUseCase'),
  /** Produces a customer report (top customers) from the reader. */
  CustomerReportUseCase: createToken<CustomerReportUseCase>('Reports.CustomerReportUseCase'),
  /** Produces a product-performance report from the reader. */
  ProductPerformanceReportUseCase: createToken<ProductPerformanceReportUseCase>(
    'Reports.ProductPerformanceReportUseCase',
  ),
} as const;

/**
 * Injection tokens for the Administration module's ports and application use
 * cases, bound to their concrete implementations in the composition root
 * (task 27.1).
 *
 * The tenant repository is bound to the UNEXTENDED `systemPrisma` client (the
 * tenant is the multi-tenancy root, not itself tenant-scoped); the
 * configuration repository is bound to the tenant-aware `tenantPrisma` client.
 * `CreateTenantUseCase` reuses the Authorization module's seeding capability via
 * the `ITenantRoleSeeder` port (satisfied by `SeedSystemRolesUseCase`).
 */
export const ADMINISTRATION_TOKENS = {
  /** Prisma-backed tenant persistence (system-scoped root aggregate). */
  TenantRepository: createToken<ITenantRepository>('Administration.TenantRepository'),
  /** Prisma-backed per-tenant key/value configuration persistence. */
  ConfigurationRepository: createToken<IConfigurationRepository>(
    'Administration.ConfigurationRepository',
  ),
  /** Prisma-backed, read-only per-tenant audit-log reader (task 27.2). */
  AuditLogRepository: createToken<IAuditLogRepository>('Administration.AuditLogRepository'),
  /** Provisions a tenant: creates it, seeds default roles/permissions + config. */
  CreateTenantUseCase: createToken<CreateTenantUseCase>('Administration.CreateTenantUseCase'),
  /** Updates a tenant's branding/localization configuration (URL-only logo). */
  UpdateTenantBrandingUseCase: createToken<UpdateTenantBrandingUseCase>(
    'Administration.UpdateTenantBrandingUseCase',
  ),
  /**
   * Updates branding WITH logo upload (storage port) + cache invalidation
   * (task 27.3, Requirements 11.3/11.4).
   */
  UpdateBrandingUseCase: createToken<UpdateBrandingUseCase>(
    'Administration.UpdateBrandingUseCase',
  ),
  /** Reads a tenant's branding with a cache-aside strategy (task 27.3). */
  GetBrandingUseCase: createToken<GetBrandingUseCase>('Administration.GetBrandingUseCase'),
  /** Upserts a single tenant configuration entry. */
  SetConfigurationUseCase: createToken<SetConfigurationUseCase>(
    'Administration.SetConfigurationUseCase',
  ),
  /** Reads a single tenant configuration entry by key. */
  GetConfigurationUseCase: createToken<GetConfigurationUseCase>(
    'Administration.GetConfigurationUseCase',
  ),
  /** Lists every configuration entry for a tenant. */
  ListConfigurationsUseCase: createToken<ListConfigurationsUseCase>(
    'Administration.ListConfigurationsUseCase',
  ),
} as const;
