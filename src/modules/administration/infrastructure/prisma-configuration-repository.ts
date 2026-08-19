import type { UUID } from '@shared/types/index.js';
import type {
  ConfigurationEntry,
  IConfigurationRepository,
  JsonValue,
} from '../domain/repositories/configuration-repository.js';

/**
 * Persistence row shape for the `Configuration` model. `value` is stored as a
 * JSON column; it is read back as an opaque value and narrowed to
 * {@link JsonValue} by the mapper.
 */
export interface ConfigurationRow {
  key: string;
  value: unknown;
}

/** Minimal `configuration` delegate surface used by the repository. */
export interface ConfigurationModelDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<ConfigurationRow | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<ConfigurationRow[]>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<ConfigurationRow>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

/** A Prisma-like client exposing (at least) the `configuration` delegate. */
export interface ConfigurationPrismaClient {
  configuration: ConfigurationModelDelegate;
}

/**
 * Prisma-backed {@link IConfigurationRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on every query.
 * Every method also applies `tenantId` explicitly (to the `where` clause and
 * `create` payload) for defence-in-depth and so the repository behaves
 * correctly when invoked OUTSIDE a request context — notably during tenant
 * provisioning, where no tenant context exists yet and the extension's
 * auto-filter passes through untouched (Requirement 1.5).
 *
 * {@link set} upserts on the `@@unique([tenantId, key])` constraint; {@link
 * delete} uses `deleteMany` so removing a missing key is a safe no-op.
 */
export class PrismaConfigurationRepository implements IConfigurationRepository {
  constructor(private readonly prisma: ConfigurationPrismaClient) {}

  async get(tenantId: UUID, key: string): Promise<ConfigurationEntry | null> {
    const row = await this.prisma.configuration.findFirst({ where: { tenantId, key } });
    return row === null ? null : PrismaConfigurationRepository.toEntry(row);
  }

  async set(tenantId: UUID, key: string, value: JsonValue): Promise<ConfigurationEntry> {
    const row = await this.prisma.configuration.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value },
      update: { value },
    });
    return PrismaConfigurationRepository.toEntry(row);
  }

  async list(tenantId: UUID): Promise<ConfigurationEntry[]> {
    const rows = await this.prisma.configuration.findMany({
      where: { tenantId },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => PrismaConfigurationRepository.toEntry(row));
  }

  async delete(tenantId: UUID, key: string): Promise<void> {
    await this.prisma.configuration.deleteMany({ where: { tenantId, key } });
  }

  /** Maps a persistence row to a {@link ConfigurationEntry}. */
  private static toEntry(row: ConfigurationRow): ConfigurationEntry {
    return { key: row.key, value: row.value as JsonValue };
  }
}
