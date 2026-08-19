import { getRequestId, getTenantId, getUserId } from '@common/context';
import {
  type AnalyticsEventName,
  type AnalyticsProperties,
  type AnalyticsPropertyValue,
} from './analytics-events.js';

/**
 * Backend analytics service (task 33.2, Requirements 13.1–13.4).
 *
 * Firebase Analytics is fundamentally a CLIENT-side SDK: the Web, Android and
 * iOS clients log user-behaviour events directly from the device. On the
 * BACKEND, "analytics" means two things:
 *
 *  1. A reusable abstraction with a CONSISTENT event-name contract shared across
 *     every platform (Requirement 13.2/13.4) — owned by `analytics-events.ts`.
 *  2. Server-side event emission for actions that happen without a client round
 *     trip (background jobs, webhooks, server-authoritative transitions). For
 *     Firebase this would flow through the GA4 **Measurement Protocol**, which
 *     needs a `measurement_id` + `api_secret`; absent those credentials in this
 *     environment, the default sink records events to the structured LOG stream
 *     (a sink a log-based analytics pipeline / GA4 BigQuery export can consume).
 *
 * The port below is the seam: a GA4 Measurement Protocol implementation (using
 * {@link IFirebaseAdmin}/env for project + api secret) can bind behind
 * {@link IAnalyticsService} later without touching any call site.
 */

/** Discriminator emitted in the `event` field of every analytics log line. */
export const ANALYTICS_LOG_EVENT = 'analytics' as const;

/**
 * The structural subset of a pino logger the analytics sink depends on.
 *
 * Declared locally so the analytics module takes no hard dependency on pino;
 * Fastify's `app.log`/`request.log` and the application root logger satisfy it,
 * mirroring the auth module's `StructuredAuthEventLogger`.
 */
export interface AnalyticsLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/** Correlation fields enriched onto every event from the request context. */
export interface AnalyticsContextFields {
  tenant_id?: string;
  user_id?: string;
  request_id?: string;
}

/**
 * Backend analytics port. Consumers depend only on this abstraction; the
 * concrete sink (structured log today, GA4 Measurement Protocol later) is bound
 * in the composition root.
 */
export interface IAnalyticsService {
  /**
   * Records an analytics event. Every event is automatically enriched with the
   * active `tenant_id`, `user_id` and `request_id` (from the request context)
   * plus an ISO-8601 `timestamp` (Requirement 13.3). Outside a request scope the
   * correlation fields are simply omitted. Never throws: analytics must not
   * break the business operation that emitted the event.
   *
   * @param eventName - A canonical name from `ANALYTICS_EVENTS` (Requirement 13.2).
   * @param properties - Optional domain-specific properties for the event.
   */
  logEvent(eventName: AnalyticsEventName, properties?: AnalyticsProperties): void;

  /**
   * Convenience alias of {@link logEvent} reading naturally at call sites
   * (`analytics.track(ANALYTICS_EVENTS.SALE_CREATED, { sale_id })`).
   */
  track(eventName: AnalyticsEventName, properties?: AnalyticsProperties): void;
}

/**
 * The fully-enriched analytics event payload handed to a sink. This is the
 * canonical shape emitted to the structured log and the shape a GA4/BigQuery
 * exporter would map from.
 */
export interface AnalyticsEvent extends AnalyticsContextFields {
  /** Constant discriminator (`'analytics'`) for log-based filtering. */
  event: typeof ANALYTICS_LOG_EVENT;
  /** The canonical event name (Requirement 13.2). */
  name: AnalyticsEventName;
  /** ISO-8601 instant the event was recorded (Requirement 13.3). */
  timestamp: string;
  /** Domain-specific properties, present only when supplied. */
  properties?: Record<string, AnalyticsPropertyValue>;
}

/** Injectable clock, so tests can assert on a deterministic timestamp. */
export type AnalyticsClock = () => Date;

const defaultClock: AnalyticsClock = () => new Date();

/**
 * Reads the request-scoped correlation identifiers from the async context,
 * omitting any that are absent (outside a request scope, or before the auth
 * middleware resolved the tenant/user). Mirrors the logger's `contextMixin` so
 * analytics lines correlate with request logs.
 */
function readContextFields(): AnalyticsContextFields {
  const fields: AnalyticsContextFields = {};

  const tenantId = getTenantId();
  if (tenantId !== undefined) {
    fields.tenant_id = tenantId;
  }

  const userId = getUserId();
  if (userId !== undefined) {
    fields.user_id = userId;
  }

  const requestId = getRequestId();
  if (requestId !== undefined) {
    fields.request_id = requestId;
  }

  return fields;
}

/**
 * Builds the enriched {@link AnalyticsEvent} for an event name + properties,
 * pulling correlation fields from the request context and stamping the time from
 * the supplied clock. Shared by the sinks so enrichment stays consistent.
 */
export function buildAnalyticsEvent(
  eventName: AnalyticsEventName,
  properties: AnalyticsProperties | undefined,
  clock: AnalyticsClock,
): AnalyticsEvent {
  const event: AnalyticsEvent = {
    event: ANALYTICS_LOG_EVENT,
    name: eventName,
    timestamp: clock().toISOString(),
    ...readContextFields(),
  };

  if (properties !== undefined) {
    event.properties = { ...properties };
  }

  return event;
}

/**
 * Default {@link IAnalyticsService}: emits each event as a single structured log
 * line (`event: 'analytics'`, `name`, `tenant_id`, `user_id`, `request_id`,
 * `timestamp`, `properties`) through the application logger.
 *
 * This log stream IS the analytics sink: a log-based pipeline (or a GA4 BigQuery
 * export) consumes the `event: 'analytics'` lines. A GA4 Measurement Protocol
 * sink can replace this implementation behind {@link IAnalyticsService} later
 * without changing any emitter. Enrichment (tenant/user/request/timestamp) is
 * automatic (Requirement 13.3); the call swallows nothing but also never throws
 * on the logger's behalf beyond what the logger itself does.
 */
export class StructuredLogAnalyticsService implements IAnalyticsService {
  constructor(
    private readonly logger: AnalyticsLogger,
    private readonly clock: AnalyticsClock = defaultClock,
  ) {}

  logEvent(eventName: AnalyticsEventName, properties?: AnalyticsProperties): void {
    const event = buildAnalyticsEvent(eventName, properties, this.clock);
    this.logger.info(event as unknown as Record<string, unknown>, 'analytics event');
  }

  track(eventName: AnalyticsEventName, properties?: AnalyticsProperties): void {
    this.logEvent(eventName, properties);
  }
}

/**
 * No-op {@link IAnalyticsService} for when analytics is disabled (e.g. a
 * deployment that opts out, or tests that assert emitters call the port without
 * caring about the sink). Every method is intentionally a no-op.
 */
export class NoopAnalyticsService implements IAnalyticsService {
  logEvent(_eventName: AnalyticsEventName, _properties?: AnalyticsProperties): void {
    // intentionally empty — analytics disabled
  }

  track(_eventName: AnalyticsEventName, _properties?: AnalyticsProperties): void {
    // intentionally empty — analytics disabled
  }
}
