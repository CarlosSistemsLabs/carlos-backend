# Cryptography infrastructure (task 43.3)

Implements **data encryption** for the Carlos ERP backend — Requirements **17.9**
(field-level encryption of sensitive data) and **17.10** (encryption in transit /
TLS 1.2+). Built entirely on Node's built-in `crypto`/`tls` — no third-party
packages.

## What lives here

| File | Responsibility |
| --- | --- |
| `field-encryptor.ts` | `IFieldEncryptor` port, `AesGcmFieldEncryptor` (AES-256-GCM), `NoopFieldEncryptor` (disabled pass-through), `FieldDecryptionError`. |
| `field-encryptor-factory.ts` | `buildFieldEncryptor(env)` — reads `FIELD_ENCRYPTION_KEY`, chooses enabled vs disabled mode. |
| `tls.ts` / `tls-runtime.ts` | TLS 1.2+ policy: `enforceMinimumTlsVersion()`, `ensureDatabaseTls()`, `databaseRequiresTls()`. |

## Passwords are HASHED, not encrypted

User passwords are one-way hashed with **bcrypt** (cost ≥ 12) in
`src/modules/auth/infrastructure/bcrypt-password-hasher.ts`. Hashing is the
correct, irreversible treatment for credentials that only ever need to be
*verified*, never *recovered*. **This module never touches passwords.**

Field-level **encryption** here is only for **reversible secrets** that must be
read back verbatim, for example:

- stored third-party API credentials / access tokens,
- plugin & integration secrets,
- service-account material,
- configuration values flagged secret.

## Field-level encryption (Requirement 17.9)

`AesGcmFieldEncryptor` uses **AES-256-GCM** (authenticated encryption):

- a **fresh random 96-bit IV** per encryption (same plaintext → different
  ciphertext),
- a **128-bit GCM auth tag** verified on decrypt (tampering / wrong key ⇒
  `FieldDecryptionError`, never a leaked value),
- a self-describing bundle: `AGCM1:<keyVersion>:<b64 iv>:<b64 tag>:<b64 ciphertext>`.

Plaintext and key material are **never logged, embedded in errors, or thrown**.

### Where it is applied / the seam

Most reversible-secret persistence is deferred (no such column is committed to
the schema yet), so — per the task's guidance — the encryptor is **not forced
into a critical path**. Instead it provides a ready **seam at the repository
mapping layer**: when a secret field lands (e.g. `IntegrationCredential.secret`),
wrap it at the persistence boundary:

```ts
// toPersistence (write): encrypt before it touches the DB
row.secret = fieldEncryptor.encrypt(entity.secret);
// toDomain (read): decrypt when hydrating the entity
entity.secret = fieldEncryptor.decrypt(row.secret);
```

Resolve a single process-wide `IFieldEncryptor` via `buildFieldEncryptor(env)`
(register it in the composition root / DI container alongside other
infrastructure singletons) and inject it into the repositories that own secret
fields. Because the port is a clean abstraction, repositories depend on it, not
on the concrete cipher.

### Key management

`FIELD_ENCRYPTION_KEY` — a 32-byte AES-256 key, **optional**:

- **64 hex chars** or **44-char base64**;
- optional `version:` prefix, e.g. `k2:<base64>` (defaults to `k1`).

Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store it in the platform secret manager (Railway variables), **not** in the repo.

**Absent key ⇒ disabled (pass-through) mode + a loud warning.** Unlike JWT
signing (which safely mints an ephemeral keypair in dev), a throwaway field key
is deliberately **not** generated — it would make persisted ciphertext
permanently unreadable after a restart. A **misconfigured** key (wrong length /
undecodable) **fails fast** at boot.

### Key rotation

The bundle records the **key version**, and `AesGcmFieldEncryptor` accepts a
**keyring** (`version → key`). To rotate:

1. Add the new key under a new version and make it active for writes
   (conceptually `FIELD_ENCRYPTION_KEY=k2:<new>`), while **retaining the old key
   under `k1`** for reads. A future `FIELD_ENCRYPTION_KEYS` keyring variable can
   carry multiple versions.
2. New writes are stamped `k2`; existing `k1` values still decrypt.
3. Optionally re-encrypt `k1` rows in the background, then drop `k1`.

## Encryption in transit — TLS 1.2+ (Requirement 17.10)

`enforceMinimumTlsVersion()` raises Node's process-wide
`tls.DEFAULT_MIN_VERSION` to **TLSv1.2** for every TLS client/server that does
not set its own `minVersion` (defence-in-depth; Node 20's default is already
`TLSv1.2`). Call it once at startup.

**Database:** require SSL on the connection string. `ensureDatabaseTls()` adds
`sslmode=require` when absent (an operator's stronger `verify-full` is
preserved). For production against managed PostgreSQL, prefer:

```
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=verify-full
```

`require` encrypts the channel; `verify-full` additionally validates the server
certificate and hostname (recommended in production).

**Redis / outbound APIs:** use `rediss://` (see `REDIS_TLS`) and HTTPS
endpoints; all inherit the enforced TLS floor.

## Encryption AT REST — managed PostgreSQL (Requirement 17.9)

At-rest encryption of the database volume is an **infrastructure/deployment**
concern, not application code, and is **not** configured from this repo:

- **Railway PostgreSQL / managed providers** encrypt data at rest by default
  (the underlying block storage is encrypted). Confirm this in the provider's
  security settings and, where the plan allows, enable customer-managed keys
  (KMS/CMEK).
- Ensure **automated backups are encrypted** and access to them is restricted.
- Field-level encryption (above) is the app-layer complement: even if the raw
  rows are exposed, flagged secret columns remain AES-256-GCM ciphertext.

See `docs/RAILWAY-SETUP-GUIDE.md` for the deployment-side checklist.
