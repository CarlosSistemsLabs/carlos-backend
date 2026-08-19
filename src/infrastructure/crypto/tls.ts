import { getDefaultMinVersion, setDefaultMinVersion } from './tls-runtime.js';

/**
 * TLS policy helpers (task 43.3, Requirement 17.10 — encrypt data IN TRANSIT).
 *
 * The platform mandates TLS 1.2 or higher for EVERY network connection:
 * inbound HTTPS (terminated by the Railway edge / load balancer), the
 * PostgreSQL connection, Redis, and all outbound calls to third-party APIs.
 *
 * These helpers are pure/additive: they set Node's process-wide minimum TLS
 * version and normalise the database URL to require SSL. They perform NO live
 * infrastructure changes — at-rest encryption and certificate management are
 * deployment concerns documented in `crypto/README` and the Railway runbook.
 */

/** Minimum TLS protocol version accepted anywhere in the platform. */
export const MIN_TLS_VERSION = 'TLSv1.2' as const;

/** Node's `secureProtocol`/`minVersion` string type for the supported floor. */
export type MinTlsVersion = typeof MIN_TLS_VERSION;

/**
 * Raises the process-wide minimum TLS version to {@link MIN_TLS_VERSION} for all
 * of Node's TLS clients/servers that do not override it explicitly.
 *
 * Node 20's built-in default is already `TLSv1.2`, so this is defence-in-depth:
 * it guarantees the floor even if a dependency or an env override lowered it,
 * and it documents the requirement in code. It never LOWERS the floor — if the
 * current default is already higher (e.g. `TLSv1.3`) it is left untouched.
 *
 * @returns the effective minimum TLS version after applying the policy.
 */
export function enforceMinimumTlsVersion(): MinTlsVersion | string {
  const current = getDefaultMinVersion();
  if (!isAtLeastTls12(current)) {
    setDefaultMinVersion(MIN_TLS_VERSION);
    return MIN_TLS_VERSION;
  }
  return current;
}

/**
 * Returns `true` when the given TLS version string is `TLSv1.2` or higher.
 * Unknown/empty values are treated as BELOW the floor so the safe action
 * (raising to {@link MIN_TLS_VERSION}) is taken.
 */
export function isAtLeastTls12(version: string | undefined): boolean {
  switch (version) {
    case 'TLSv1.2':
    case 'TLSv1.3':
      return true;
    default:
      return false;
  }
}

/**
 * Ensures a PostgreSQL connection string requires TLS by adding `sslmode=require`
 * when no `sslmode` is present. An existing `sslmode` (e.g. the stronger
 * `verify-full`) is always PRESERVED — an operator's explicit choice wins.
 *
 * `require` encrypts the connection; `verify-full` additionally validates the
 * server certificate and hostname and is recommended for production against a
 * managed PostgreSQL provider that publishes a CA. If the URL cannot be parsed
 * it is returned unchanged so the datasource layer surfaces a meaningful error
 * rather than this helper masking it.
 */
export function ensureDatabaseTls(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require');
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

/**
 * Reports whether a PostgreSQL connection string enforces TLS. `true` when
 * `sslmode` is one of `require`, `verify-ca`, or `verify-full`; `false` for
 * `disable`/`allow`/`prefer` (which permit an unencrypted connection) or an
 * unparseable/missing value.
 */
export function databaseRequiresTls(databaseUrl: string): boolean {
  try {
    const sslmode = new URL(databaseUrl).searchParams.get('sslmode');
    return sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full';
  } catch {
    return false;
  }
}
