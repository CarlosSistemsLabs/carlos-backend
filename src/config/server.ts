import Fastify, { type FastifyInstance } from 'fastify';
import { env } from '@config/environment';
import { buildLoggerOptions } from '@common/logging';
import { registerOpenApi } from '@config/openapi';
import { registerMiddlewares, registerAuthentication, registerAuthorization } from '@presentation/middlewares';
import { registerFeatureFlagAuthorization } from '@presentation/middlewares/feature-flag';
import { resolveRequestId, REQUEST_ID_HEADER } from '@presentation/middlewares/request-id';
import { Container, INFRASTRUCTURE_TOKENS, AUTH_TOKENS, AUTHORIZATION_TOKENS, SUBSCRIPTION_TOKENS, PRODUCT_TOKENS, STOCK_TOKENS, CUSTOMER_TOKENS, SUPPLIER_TOKENS, SALES_TOKENS, PURCHASE_TOKENS, CASH_TOKENS, REPORT_TOKENS, ADMINISTRATION_TOKENS } from '@infrastructure/di/index.js';
import {
  registerInfrastructure,
  registerAuthInfrastructure,
  registerAuthorizationInfrastructure,
  registerSubscriptionInfrastructure,
  registerProductInfrastructure,
  registerStockInfrastructure,
  registerCustomerInfrastructure,
  registerSupplierInfrastructure,
  registerSalesInfrastructure,
  registerPurchaseInfrastructure,
  registerCashInfrastructure,
  registerReportInfrastructure,
  registerAdministrationInfrastructure,
  registerFirebaseInfrastructure,
  wireStockEventSubscriptions,
} from '@infrastructure/composition-root';
import { registerAuthRoutes } from '@modules/auth/presentation/auth.routes.js';
import { registerProductRoutes } from '@modules/products/presentation/product.routes.js';
import { registerCategoryRoutes } from '@modules/products/presentation/category.routes.js';
import { registerStockRoutes } from '@modules/stock/presentation/stock.routes.js';
import { registerCustomerRoutes } from '@modules/customers/presentation/customer.routes.js';
import { registerSupplierRoutes } from '@modules/suppliers/presentation/supplier.routes.js';
import { registerSaleRoutes } from '@modules/sales/presentation/sale.routes.js';
import { registerPurchaseRoutes } from '@modules/purchases/presentation/purchase.routes.js';
import { registerCashRoutes } from '@modules/cash/presentation/cash.routes.js';
import { registerPaymentRoutes } from '@modules/cash/presentation/payment.routes.js';
import { registerReportRoutes } from '@modules/reports/presentation/report.routes.js';
import { registerAiRoutes } from '@/ai/presentation/ai.routes.js';
import { ResilientAIService } from '@/ai/index.js';
import { registerAdminRoutes } from '@modules/administration/presentation/admin.routes.js';
import { registerBrandingRoutes } from '@modules/administration/presentation/branding.routes.js';
import { registerSubscriptionRoutes } from '@modules/subscriptions/presentation/subscription.routes.js';
import { HealthCheckRegistry, createDatabaseHealthCheck, registerHealthRoutes } from '@modules/health/index.js';
import { prisma } from '@infrastructure/database/index.js';
import { InMemoryMetrics, registerRequestMetrics, registerMetricsRoutes, MetricsPerformanceTracer } from '@common/monitoring';
import {
  LogAlertNotifier,
  ErrorRateMonitor,
  SuspiciousActivityDetector,
} from '@common/alerting';
import { StructuredLogCrashReporter } from '@common/crash-reporting';
import { SecurityEventLogger } from '@common/security';

/**
 * Builds and configures the Fastify application instance.
 *
 * The request id is derived from the inbound `x-request-id` header when present
 * (preserving upstream correlation ids) or generated as a UUID otherwise. The
 * cross-cutting middleware (request context, request id echo, structured request
 * logging, and the consistent error handler) is registered here, followed by
 * the OpenAPI documentation and the authentication module (token service,
 * repositories and the public auth routes under `/api/v1/auth`).
 *
 * An optional {@link Container} may be supplied to override the composition
 * (primarily for tests, e.g. in-memory repositories); otherwise a container is
 * built with the infrastructure + auth registrations.
 */
export async function buildServer(container?: Container): Promise<FastifyInstance> {
  const app = Fastify({
    // Centralized structured-logging configuration (task 31.1): JSON output,
    // ISO timestamp, secret redaction, per-environment level, and a context
    // `mixin` that stamps request_id/tenant_id/user_id on every log line while
    // inside a request scope (Requirements 21.1, 21.2, 21.5).
    logger: buildLoggerOptions(env),
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: (req) => resolveRequestId(req),
  });

  // Error tracking + alerting (task 31.4, Requirements 21.5, 21.7, 17.8). A
  // single log-based alert notifier (the default IAlertNotifier — a real
  // Slack/PagerDuty/email transport binds behind this same port in ops/infra
  // later) backs two rolling-window monitors:
  //   - the critical error-rate monitor, fed one observation per 5xx by the
  //     error handler; it raises an alert when > threshold 5xx occur within the
  //     window (with a cooldown to avoid alert storms), and
  //   - the suspicious-activity detector, fed failed-login/lockout signals by
  //     the auth event logger (via DetectingAuthEventLogger, wired below) and
  //     401/403 bursts by the error handler.
  // Thresholds/window/cooldown are configurable via environment.ts.
  const alertNotifier = new LogAlertNotifier(app.log);
  const errorRateMonitor = new ErrorRateMonitor(alertNotifier, {
    threshold: env.ERROR_ALERT_THRESHOLD,
    windowMs: env.ERROR_ALERT_WINDOW_MS,
    cooldownMs: env.ERROR_ALERT_COOLDOWN_MS,
  });
  const suspiciousActivityDetector = new SuspiciousActivityDetector(alertNotifier, {
    threshold: env.SUSPICIOUS_ACTIVITY_THRESHOLD,
    windowMs: env.SUSPICIOUS_ACTIVITY_WINDOW_MS,
    cooldownMs: env.SUSPICIOUS_ACTIVITY_COOLDOWN_MS,
  });

  // Server-side crash/error-reporting seam (task 33.3, Requirements 13.6, 21.8).
  // The default StructuredLogCrashReporter emits an `event:'error_report'` line
  // (distinct from the plain 5xx `error` log) that the ops pipeline forwards to
  // an external crash tracker; a real reporter (e.g. Sentry's Node SDK) binds
  // behind the SAME ICrashReporter port later. The ACTUAL Firebase Crashlytics
  // integration is a CLIENT concern living in the Android (task 51.3) and iOS
  // (task 56.3) apps — there is no server-side Crashlytics SDK. Bound to
  // `app.log` (mirroring the alert notifier) and passed to the error handler so
  // every 5xx/unknown error is reported through it with tenant/user/request +
  // feature/module context.
  const crashReporter = new StructuredLogCrashReporter(app.log);

  // Security-event audit logger (task 43.4, Requirements 17.7, 17.8). The single,
  // cohesive seam through which non-auth security events are recorded as
  // consistent, queryable `event:'security_event'` audit lines: authorization
  // failures (emitted by the `app.authorize` guard, wired below) and
  // suspicious activity such as rate-limit hits (emitted from the error handler's
  // 429 path via the `onRateLimit` observer below). Authentication attempts stay
  // owned by the auth module's StructuredAuthEventLogger (composed, not
  // duplicated). Bound to `app.log`, mirroring the alert notifier / crash
  // reporter.
  const securityAuditLogger = new SecurityEventLogger(app.log);

  await registerMiddlewares(
    app,
    {
      onServerError: (info) => {
        errorRateMonitor.recordServerError({
          statusCode: info.statusCode,
          path: info.path,
          requestId: info.requestId,
        });
      },
      onAuthFailure: (info) => {
        suspiciousActivityDetector.record({
          kind: 'authz_failure',
          key: info.userId ?? info.ipAddress,
          context: {
            status_code: info.statusCode,
            method: info.method,
            path: info.path,
            ip_address: info.ipAddress,
            request_id: info.requestId,
          },
        });
      },
      onRateLimit: (info) => {
        // A rate-limit (429) hit is recorded both as a security-audit line
        // (queryable suspicious activity) and as a detector signal so repeated
        // throttling of the same caller trips an administrator alert
        // (Requirement 17.8).
        securityAuditLogger.rateLimitExceeded({
          ipAddress: info.ipAddress,
          method: info.method,
          path: info.path,
          ...(info.userId !== undefined ? { userId: info.userId } : {}),
          requestId: info.requestId,
        });
        suspiciousActivityDetector.record({
          kind: 'rate_limit',
          key: info.userId ?? info.ipAddress,
          context: {
            status_code: info.statusCode,
            method: info.method,
            path: info.path,
            ip_address: info.ipAddress,
            request_id: info.requestId,
          },
        });
      },
    },
    crashReporter,
  );
  await registerOpenApi(app);

  // Public health probes (task 31.2, Requirement 21.4). Registered EARLY and
  // OUTSIDE the `/api/v1` prefix so container orchestrators can reach them
  // regardless of the rest of the wiring, and with NO auth/RBAC/feature guards
  // (probes must not require a token). The readiness registry currently holds a
  // single critical `database` check that runs `SELECT 1` behind a short
  // timeout; a failure/timeout flips readiness to 503. The Redis check
  // (task 39.1) and external-service checks (task 33.x) register the same
  // IHealthCheck port on this registry once those dependencies are configured —
  // no probe/route change is required when they land. Liveness performs no
  // dependency checks by design (a downstream outage must not restart a healthy
  // process).
  const healthRegistry = new HealthCheckRegistry();
  healthRegistry.register(createDatabaseHealthCheck(() => prisma.$queryRaw`SELECT 1`));
  await registerHealthRoutes(app, { registry: healthRegistry });

  // Performance-metrics tracking (task 31.3, Requirements 21.6, 21.3). A single
  // in-process metrics registry is shared by the request hook and the scrape
  // endpoint. The `onRequest`/`onResponse` hook records request rate, status
  // classes (→ error rate), per-route response-time percentiles, and the
  // in-flight (active connections) gauge; route labels are collapsed to the
  // matched route PATTERN to bound cardinality. `GET /metrics` (unauthenticated,
  // outside `/api/v1`, gated by METRICS_ENABLED) returns the JSON snapshot for
  // internal scraping — see the route module for the security note. DB-query
  // durations can be captured by applying `createDbMetricsExtension(metrics)` to
  // the Prisma client (documented integration point). The registry is the
  // OpenTelemetry seam: swap `InMemoryMetrics` for an OTel/Prometheus-backed
  // IMetrics without touching the hook or route.
  const metrics = new InMemoryMetrics();
  registerRequestMetrics(app, metrics);
  await registerMetricsRoutes(app, { metrics, enabled: env.METRICS_ENABLED });

  // Compose the authentication module. The container is built (or reused) here
  // so the auth token service, repositories and audit logger resolve for both
  // the route-level guard and the public auth routes. The Fastify logger is
  // injected as the structured audit sink (Requirement 17.7).
  //
  // A caller-supplied container that already has the auth dependencies bound
  // (e.g. a test wiring in-memory fakes) is used as-is; otherwise the
  // production auth infrastructure (token service + Prisma repositories) is
  // registered.
  const authContainer = container ?? registerInfrastructure(new Container());

  // Performance tracer (task 33.4, Requirements 13.7, 21.9). Backend "custom
  // traces" — arbitrary named operation timings, the analogue of Firebase
  // Performance custom traces — are recorded through the SAME metrics registry
  // that serves `/metrics`, so they surface under `customTraces` alongside the
  // request-latency and DB-query stats (task 31.3) rather than duplicating them.
  // API response times are already tracked by the request hook; DB query timing
  // by the Prisma metrics extension; screen load times are client-side
  // (Web/Android/iOS Firebase Performance SDKs). Registered idempotently so a
  // caller-supplied (test) container that bound its own tracer is reused as-is.
  if (!authContainer.has(INFRASTRUCTURE_TOKENS.PerformanceTracer)) {
    authContainer.registerValue(
      INFRASTRUCTURE_TOKENS.PerformanceTracer,
      new MetricsPerformanceTracer(metrics),
    );
  }
  if (!authContainer.has(AUTH_TOKENS.TokenService)) {
    // The suspicious-activity detector is injected so failed-login/lockout
    // events feed it (Requirement 17.8) in addition to the structured audit log.
    await registerAuthInfrastructure(authContainer, env, app.log, suspiciousActivityDetector);
  }

  // Compose the Firebase Admin client (task 33.1, Requirements 13.5/14.2). When
  // no service-account credentials are configured it resolves to a no-op client
  // (isEnabled === false); when present it initializes a singleton admin app for
  // the env-specified (TEST vs PRODUCTION) Firebase project. Registered lazily so
  // a caller-supplied (test) container that bound a fake is reused. The Fastify
  // logger is injected so the enabled/disabled boot line joins the app log.
  await registerFirebaseInfrastructure(authContainer, env, { logger: app.log });

  const tokenService = authContainer.resolve(AUTH_TOKENS.TokenService);
  registerAuthentication(app, tokenService);

  // Compose the Authorization (RBAC) module so `app.authorize(module, screen,
  // action)` can resolve a user's role and check permissions on protected
  // routes. Bound to the role repository from the container; registered lazily
  // so a caller-supplied (test) container that already wired a role repository
  // is reused as-is.
  if (!authContainer.has(AUTHORIZATION_TOKENS.RoleRepository)) {
    registerAuthorizationInfrastructure(authContainer);
  }
  registerAuthorization(
    app,
    authContainer.resolve(AUTHORIZATION_TOKENS.RoleRepository),
    securityAuditLogger,
  );

  // Compose the Subscriptions module so `app.requireFeature('stock')` can
  // resolve tenant feature access (subscription plan + feature flags) on
  // protected routes (Requirements 10.4, 12.3, 12.4). Bound to the feature
  // access service from the container; registered lazily so a caller-supplied
  // (test) container that already wired the service is reused as-is.
  if (!authContainer.has(SUBSCRIPTION_TOKENS.FeatureAccessService)) {
    registerSubscriptionInfrastructure(authContainer);
  }
  registerFeatureFlagAuthorization(
    app,
    authContainer.resolve(SUBSCRIPTION_TOKENS.FeatureAccessService),
  );

  await registerAuthRoutes(app, authContainer);

  // Compose the Products module. The product/category repositories and
  // catalogue use cases are registered lazily so a caller-supplied (test)
  // container that already wired the product use cases is reused as-is. Product
  // routes are mounted AFTER auth routes and rely on the `authenticate`,
  // `authorize` and `requireFeature` decorators registered above.
  if (!authContainer.has(PRODUCT_TOKENS.ListProductsUseCase)) {
    registerProductInfrastructure(authContainer);
  }
  await registerProductRoutes(app, authContainer);

  // Compose the Categories endpoints. `registerProductInfrastructure` (invoked
  // above) also binds the category repository + category use cases, so the
  // catalogue and its categories share the same container. Mounted AFTER the
  // product routes, mirroring their wiring.
  await registerCategoryRoutes(app, authContainer);

  // Compose the Stock module. The stock repositories, unit of work and
  // inventory use cases are registered lazily so a caller-supplied (test)
  // container that already wired them is reused as-is. Mounted AFTER the
  // category routes, mirroring the product/category wiring. Once the stock
  // infrastructure is present, the event consumers (SaleCompleted → decrement,
  // PurchaseCompleted → increment) are subscribed to the application event bus
  // exactly once so those handlers are active at bootstrap (task 15.2).
  if (!authContainer.has(STOCK_TOKENS.GetStockLevelsUseCase)) {
    registerStockInfrastructure(authContainer);
    wireStockEventSubscriptions(authContainer);
  }
  await registerStockRoutes(app, authContainer);

  // Compose the Customers module. The customer repository and use cases are
  // registered lazily so a caller-supplied (test) container that already wired
  // them is reused as-is. Mounted AFTER the stock routes, mirroring the
  // product/stock wiring, and relying on the `authenticate`, `authorize` and
  // `requireFeature` decorators registered above.
  if (!authContainer.has(CUSTOMER_TOKENS.ListCustomersUseCase)) {
    registerCustomerInfrastructure(authContainer);
  }
  await registerCustomerRoutes(app, authContainer);

  // Compose the Suppliers module. The supplier repository and use cases are
  // registered lazily so a caller-supplied (test) container that already wired
  // them is reused as-is. Mounted AFTER the customer routes, mirroring the
  // customer wiring, and relying on the `authenticate`, `authorize` and
  // `requireFeature` decorators registered above.
  if (!authContainer.has(SUPPLIER_TOKENS.ListSuppliersUseCase)) {
    registerSupplierInfrastructure(authContainer);
  }
  await registerSupplierRoutes(app, authContainer);

  // Compose the Sales module. The sale repository, unit of work, reader ports
  // and the create/read/update/delete use cases are registered lazily so a
  // caller-supplied (test) container that already wired them is reused as-is.
  // Mounted AFTER the supplier routes, mirroring the customer/supplier wiring,
  // and relying on the `authenticate`, `authorize` and `requireFeature`
  // decorators registered above. The sale event publishing reuses the same
  // application event bus the stock consumers subscribe to.
  if (!authContainer.has(SALES_TOKENS.ListSalesUseCase)) {
    registerSalesInfrastructure(authContainer);
  }
  await registerSaleRoutes(app, authContainer);

  // Compose the Purchases module. The purchase repository, unit of work, reader
  // ports and the create/read/update/delete use cases are registered lazily so
  // a caller-supplied (test) container that already wired them is reused as-is.
  // Mounted AFTER the sale routes, mirroring the sales wiring, and relying on
  // the `authenticate`, `authorize` and `requireFeature` decorators registered
  // above. Purchase event publishing reuses the same application event bus the
  // stock consumers subscribe to (PurchaseCompleted → stock increment).
  if (!authContainer.has(PURCHASE_TOKENS.ListPurchasesUseCase)) {
    registerPurchaseInfrastructure(authContainer);
  }
  await registerPurchaseRoutes(app, authContainer);

  // Compose the Cash module. The cash/movement/payment repositories, unit of
  // work, reader ports and the register open/close, movement record/list and
  // payment record/list/status use cases are registered lazily so a
  // caller-supplied (test) container that already wired them is reused as-is.
  // Mounted AFTER the purchase routes, mirroring their wiring, and relying on
  // the `authenticate`, `authorize` and `requireFeature` decorators registered
  // above. Both route groups (`/api/v1/cash` and `/api/v1/payments`) are gated
  // behind the Business-tier `cash` feature.
  if (!authContainer.has(CASH_TOKENS.ListPaymentsUseCase)) {
    registerCashInfrastructure(authContainer);
  }
  await registerCashRoutes(app, authContainer);
  await registerPaymentRoutes(app, authContainer);

  // Compose the Reports module. The reader ports (against the shared Sale,
  // Stock, CashMovement, Customer, Product, SaleDetail tables) and the five
  // read-only report use cases (sales, stock, cash-flow, customers, products)
  // are registered lazily so a caller-supplied (test) container that already
  // wired them is reused as-is. Mounted AFTER the cash/payment routes and gated
  // behind the Business-tier `reports` feature, relying on the `authenticate`,
  // `authorize` and `requireFeature` decorators registered above.
  if (!authContainer.has(REPORT_TOKENS.SalesReportUseCase)) {
    registerReportInfrastructure(authContainer);
  }
  await registerReportRoutes(app, authContainer);

  // Compose the AI Integration endpoints (task 37.3, Requirement 20.1) under
  // `/api/v1/ai`: the sales assistant, natural-language query and AI report
  // generation. The resilient AI service (task 37.2) is bound by
  // `registerInfrastructure`; in the normal bootstrap it is already present, so
  // it is only bound here (as a default ResilientAIService with NO providers →
  // disabled / graceful degradation, Requirement 20.5) when a caller-supplied
  // (test) container did not wire one. Mounted AFTER the report routes and gated
  // behind the Enterprise-only `ai` feature, relying on the `authenticate`,
  // `authorize` and `requireFeature` decorators registered above. When no AI
  // provider is configured (the default in this environment) the capability
  // services throw `AIUnavailableError` → 503 through the central error handler.
  if (!authContainer.has(INFRASTRUCTURE_TOKENS.AIService)) {
    authContainer.registerValue(
      INFRASTRUCTURE_TOKENS.AIService,
      new ResilientAIService({ providers: [], logger: app.log }),
    );
  }
  await registerAiRoutes(app, authContainer);

  // Compose the Administration module's admin endpoints (task 27.2). The audit
  // reader + tenant/configuration repositories are registered lazily so a
  // caller-supplied (test) container that already wired them is reused as-is.
  // Mounted AFTER the report routes. These routes rely on the `authenticate`
  // and `authorize` decorators registered above; they are NOT feature-gated
  // (administration is core tenant-management, not a plan-tier feature) and
  // instead require the strict `administration` RBAC permission — held only by
  // the Admin system role. User creation + role assignment reuse the auth +
  // authorization repositories registered earlier in this bootstrap.
  if (!authContainer.has(ADMINISTRATION_TOKENS.AuditLogRepository)) {
    registerAdministrationInfrastructure(authContainer);
  }
  await registerAdminRoutes(app, authContainer);

  // Branding endpoints (task 27.3) under `/api/v1/branding`: GET is readable by
  // any authenticated tenant user (they need branding to render the UI on
  // login, Requirement 11.2); PUT is admin-only (`administration:settings:write`)
  // and uploads any logo asset via the storage port (Requirement 11.3) then
  // invalidates the branding cache so the change propagates immediately
  // (Requirement 11.4). Relies on the `authenticate`/`authorize` decorators
  // registered above and reuses the administration use cases registered lazily
  // for the admin routes; not feature-gated (core tenant-management).
  await registerBrandingRoutes(app, authContainer);

  // Subscription-management endpoints (task 29.3): `/api/v1/subscriptions`
  // (create/current/upgrade) and the public `/api/v1/plans` catalogue. The
  // plan/subscription repositories + management use cases are registered
  // lazily so a caller-supplied (test) container that already wired them is
  // reused as-is; in the normal bootstrap `registerSubscriptionInfrastructure`
  // ran earlier (guarded on the FeatureAccessService) and already registered
  // these use cases. Mounted AFTER the admin/branding routes and relying on the
  // `authenticate`/`authorize` decorators registered above.
  //
  // IMPORTANT: these routes are NOT feature-gated (`requireFeature`). Gating
  // subscription management behind the feature guard would trap a tenant with an
  // expired/absent subscription — they could never re-subscribe to restore
  // access. Writes (create/upgrade) require the `administration:subscription:write`
  // RBAC grant (Admin only); reading the current subscription and listing plans
  // require authentication alone.
  if (!authContainer.has(SUBSCRIPTION_TOKENS.CreateSubscriptionUseCase)) {
    registerSubscriptionInfrastructure(authContainer);
  }
  await registerSubscriptionRoutes(app, authContainer);

  return app;
}
