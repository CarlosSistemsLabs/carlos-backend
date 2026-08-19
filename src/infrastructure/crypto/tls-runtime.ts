import tls from 'node:tls';

/**
 * Thin, isolated wrapper around Node's process-wide TLS defaults
 * (`tls.DEFAULT_MIN_VERSION`).
 *
 * Kept separate from {@link import('./tls.js')} so the policy logic there stays
 * pure and unit-testable while this module is the single place that touches
 * mutable global runtime state. `tls.DEFAULT_MIN_VERSION` is a writable property
 * that governs the minimum protocol version for every TLS socket that does not
 * set `minVersion` itself.
 */

/** Reads Node's current default minimum TLS version. */
export function getDefaultMinVersion(): string {
  return tls.DEFAULT_MIN_VERSION;
}

/** Sets Node's default minimum TLS version for all subsequent connections. */
export function setDefaultMinVersion(version: 'TLSv1.2' | 'TLSv1.3'): void {
  tls.DEFAULT_MIN_VERSION = version;
}
