/**
 * Public interface of the resilience module (task 41.x, Requirement 27.3).
 *
 * Groups the cross-cutting stability policies that guard calls to flaky
 * downstream dependencies (external plugin integrations, AI providers, outbound
 * HTTP): the CIRCUIT BREAKER (task 41.2), RETRY with backoff (task 41.3) and
 * GRACEFUL DEGRADATION (task 41.4). Consumers import from this barrel rather
 * than the individual files.
 */
export * from './circuit-breaker.js';
export * from './retry.js';
export * from './degrade.js';
