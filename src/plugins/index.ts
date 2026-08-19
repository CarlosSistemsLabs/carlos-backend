export { PluginType, PaymentStatus, ReportExportFormat } from './plugin.js';
export type {
  PluginMetadata,
  PluginLogger,
  PluginContext,
  IPlugin,
  MonetaryAmount,
  PaymentRequest,
  PaymentResult,
  PaymentPlugin,
  MessageRequest,
  MessageResult,
  MessagingPlugin,
  SyncResult,
  EcommercePlugin,
  ReportExportRequest,
  ReportExportResult,
  ReportingPlugin,
  AICompletionRequest,
  AICompletionResult,
  AIAnalysisRequest,
  AIAnalysisResult,
  AIPlugin,
} from './plugin.js';

export { PluginRegistry } from './plugin-registry.js';

export { PluginError, DuplicatePluginError, PluginLoadError, PluginLoadPhase } from './plugin-errors.js';

export { PluginLoader } from './plugin-loader.js';
export type {
  PluginFactory,
  PluginConfigResolver,
  PluginLoaderOptions,
  PluginFailure,
  PluginLoadResult,
} from './plugin-loader.js';

export { PluginActivationService, defaultPluginFeatureKey } from './plugin-activation-service.js';
export type {
  PluginFeatureAccess,
  PluginFeatureKey,
  PluginActivationOptions,
} from './plugin-activation-service.js';

/* External-service integration contracts (task 35.3, Requirement 19.2). */
export * from './integrations/index.js';
