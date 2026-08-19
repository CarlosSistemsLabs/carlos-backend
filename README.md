# carlos-backend

Core backend service (Modular Monolith) for the Carlos ERP platform, built with **Node.js, TypeScript, Fastify, Prisma and PostgreSQL**, following Clean Architecture and Domain-Driven Design principles.

## Tech Stack

- **Runtime:** Node.js 20+ (ES Modules)
- **Language:** TypeScript (strict mode)
- **Web framework:** Fastify 5
- **Validation:** Zod
- **Testing:** Vitest
- **Tooling:** ESLint 9 (flat config) + Prettier

## Project Structure

The codebase follows Clean Architecture layers with dependency inversion (the `domain` layer has no external dependencies):

```
src/
├── domain/          # Enterprise business rules (entities, value-objects, repositories, events, errors)
├── application/     # Application business rules (use-cases, services, dto, ports)
├── infrastructure/  # Frameworks & drivers (database, repositories, cache, storage, events, external)
├── presentation/    # Interface adapters (http, middlewares, validators, serializers)
├── modules/         # Feature modules / bounded contexts (auth, sales, stock, customers, ...)
├── shared/          # Shared kernel (types, utils, constants)
├── common/          # Cross-cutting concerns (logging, monitoring, security)
└── config/          # Configuration (environment, server, ...)
```

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment template and adjust values
cp .env.example .env

# Run in development (hot reload)
npm run dev

# Type-check, lint, and format
npm run typecheck
npm run lint
npm run format

# Build and run the production bundle
npm run build
npm start

# Run tests
npm test
```

## Path Aliases

TypeScript path aliases are configured for each layer and rewritten to relative paths at build time via `tsc-alias`:

| Alias              | Path                  |
| ------------------ | --------------------- |
| `@/*`              | `src/*`               |
| `@domain/*`        | `src/domain/*`        |
| `@application/*`   | `src/application/*`   |
| `@infrastructure/*`| `src/infrastructure/*`|
| `@presentation/*`  | `src/presentation/*`  |
| `@modules/*`       | `src/modules/*`       |
| `@shared/*`        | `src/shared/*`        |
| `@common/*`        | `src/common/*`        |
| `@config/*`        | `src/config/*`        |

## TLS / Proxy Note

If this machine runs behind an SSL-inspecting proxy or antivirus and `npm install`
fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, regenerate the CA bundle that
`.npmrc` points at:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-ca-bundle.ps1
```
