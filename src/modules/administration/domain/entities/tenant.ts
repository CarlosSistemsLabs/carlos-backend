import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import { BrandColor } from '../value-objects/brand-color.js';
import { Theme } from '../value-objects/theme.js';

/** Default localization/branding values, mirroring the `Tenant` Prisma schema. */
export const TENANT_DEFAULTS = {
  THEME: 'light',
  LANGUAGE: 'es',
  TIMEZONE: 'America/Argentina/Buenos_Aires',
  CURRENCY: 'ARS',
  DATE_FORMAT: 'DD/MM/YYYY',
} as const;

/** Inclusive length bounds for a tenant slug. */
export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 63;

/** DNS-label-like slug: lower-case letters/digits/hyphens, no leading/trailing hyphen. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Attributes describing a tenant and its branding configuration. */
export interface TenantProps {
  /** Commercial name shown to users (Requirement 11.1). */
  name: string;
  /** URL-safe unique identifier; immutable after creation. */
  slug: string;
  /** Logo asset URL (upload handled by task 27.3); `null` when unset. */
  logo: Nullable<string>;
  primaryColor: Nullable<BrandColor>;
  secondaryColor: Nullable<BrandColor>;
  theme: Theme;
  language: string;
  timezone: string;
  currency: string;
  dateFormat: string;
  /** Fiscal identifier (Tax Data, Requirement 11.1); `null` when unset. */
  taxId: Nullable<string>;
}

/** Input accepted by {@link Tenant.create} when provisioning a new tenant. */
export interface CreateTenantInput {
  name: string;
  slug: string;
  logo?: Nullable<string>;
  primaryColor?: BrandColor | string | null;
  secondaryColor?: BrandColor | string | null;
  theme?: Theme | string;
  language?: string;
  timezone?: string;
  currency?: string;
  dateFormat?: string;
  taxId?: Nullable<string>;
}

/**
 * Mutable branding/localization fields accepted by {@link Tenant.updateBranding}.
 *
 * Every field is optional; only fields present on the object are changed. Pass
 * `null` to clear an optional field (`logo`, `primaryColor`, `secondaryColor`,
 * `taxId`). The immutable `slug` is intentionally absent.
 */
export interface UpdateBrandingInput {
  name?: string;
  logo?: Nullable<string>;
  primaryColor?: BrandColor | string | null;
  secondaryColor?: BrandColor | string | null;
  theme?: Theme | string;
  language?: string;
  timezone?: string;
  currency?: string;
  dateFormat?: string;
  taxId?: Nullable<string>;
}

/**
 * Tenant aggregate root (Requirements 1.4, 11.1).
 *
 * The tenant is the multi-tenancy root: it is NOT itself scoped by a
 * `tenantId`, which is why its persistence uses the unextended `systemPrisma`
 * client (see the module facade). It owns the branding/customization
 * configuration — commercial name, logo, colours, theme, tax data and the
 * localization quartet (language/timezone/currency/date format) — with each
 * visual field validated through its value object.
 *
 * Cross-aggregate concerns (per-tenant seeded roles/permissions and default
 * configurations, and slug uniqueness) live at the use-case level; the entity
 * guarantees only that the values it holds are individually well-formed.
 */
export class Tenant extends AggregateRoot<TenantProps> {
  private constructor(props: TenantProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Defines a brand-new tenant, applying schema defaults for any omitted
   * branding/localization field and validating every invariant.
   *
   * @throws {ValidationError} when the name/slug is empty or malformed, or a
   *   branding field is invalid.
   */
  static create(input: CreateTenantInput, id?: UUID): Tenant {
    return new Tenant(
      {
        name: Tenant.assertName(input.name),
        slug: Tenant.assertSlug(input.slug),
        logo: Tenant.assertLogo(input.logo),
        primaryColor: Tenant.toColor(input.primaryColor),
        secondaryColor: Tenant.toColor(input.secondaryColor),
        theme: Tenant.toTheme(input.theme) ?? Theme.light(),
        language: Tenant.assertLocale(input.language, 'language', TENANT_DEFAULTS.LANGUAGE),
        timezone: Tenant.assertLocale(input.timezone, 'timezone', TENANT_DEFAULTS.TIMEZONE),
        currency: Tenant.assertLocale(input.currency, 'currency', TENANT_DEFAULTS.CURRENCY),
        dateFormat: Tenant.assertLocale(input.dateFormat, 'dateFormat', TENANT_DEFAULTS.DATE_FORMAT),
        taxId: Tenant.assertTaxId(input.taxId),
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Tenant} from already-validated persisted state. Trusts
   * the data store and performs no re-validation, mirroring the other module
   * aggregates.
   */
  static reconstitute(id: UUID, props: TenantProps): Tenant {
    return new Tenant({ ...props }, id);
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): string {
    return this.props.slug;
  }

  get logo(): Nullable<string> {
    return this.props.logo;
  }

  get primaryColor(): Nullable<BrandColor> {
    return this.props.primaryColor;
  }

  get secondaryColor(): Nullable<BrandColor> {
    return this.props.secondaryColor;
  }

  get theme(): Theme {
    return this.props.theme;
  }

  get language(): string {
    return this.props.language;
  }

  get timezone(): string {
    return this.props.timezone;
  }

  get currency(): string {
    return this.props.currency;
  }

  get dateFormat(): string {
    return this.props.dateFormat;
  }

  get taxId(): Nullable<string> {
    return this.props.taxId;
  }

  /**
   * Updates branding/localization fields (Requirement 11.1). Only fields
   * present on `input` are changed; pass `null` to clear an optional field. The
   * actual logo asset UPLOAD to cloud storage is task 27.3 — here `logo` is a
   * plain URL string.
   *
   * @throws {ValidationError} when a provided field is empty/malformed.
   */
  updateBranding(input: UpdateBrandingInput): void {
    if ('name' in input && input.name !== undefined) {
      this.props.name = Tenant.assertName(input.name);
    }
    if ('logo' in input) {
      this.props.logo = Tenant.assertLogo(input.logo);
    }
    if ('primaryColor' in input) {
      this.props.primaryColor = Tenant.toColor(input.primaryColor);
    }
    if ('secondaryColor' in input) {
      this.props.secondaryColor = Tenant.toColor(input.secondaryColor);
    }
    if ('theme' in input && input.theme !== undefined) {
      this.props.theme = Tenant.toTheme(input.theme) ?? this.props.theme;
    }
    if ('language' in input && input.language !== undefined) {
      this.props.language = Tenant.assertLocale(
        input.language,
        'language',
        TENANT_DEFAULTS.LANGUAGE,
      );
    }
    if ('timezone' in input && input.timezone !== undefined) {
      this.props.timezone = Tenant.assertLocale(
        input.timezone,
        'timezone',
        TENANT_DEFAULTS.TIMEZONE,
      );
    }
    if ('currency' in input && input.currency !== undefined) {
      this.props.currency = Tenant.assertLocale(
        input.currency,
        'currency',
        TENANT_DEFAULTS.CURRENCY,
      );
    }
    if ('dateFormat' in input && input.dateFormat !== undefined) {
      this.props.dateFormat = Tenant.assertLocale(
        input.dateFormat,
        'dateFormat',
        TENANT_DEFAULTS.DATE_FORMAT,
      );
    }
    if ('taxId' in input) {
      this.props.taxId = Tenant.assertTaxId(input.taxId);
    }
  }

  private static assertName(name: string): string {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Tenant name is required', { field: 'name' });
    }
    return name.trim();
  }

  private static assertSlug(slug: string): string {
    if (typeof slug !== 'string' || slug.trim().length === 0) {
      throw new ValidationError('Tenant slug is required', { field: 'slug' });
    }
    const normalized = slug.trim().toLowerCase();
    if (normalized.length < SLUG_MIN_LENGTH || normalized.length > SLUG_MAX_LENGTH) {
      throw new ValidationError(
        `Tenant slug must be between ${SLUG_MIN_LENGTH} and ${SLUG_MAX_LENGTH} characters`,
        { field: 'slug' },
      );
    }
    if (!SLUG_PATTERN.test(normalized)) {
      throw new ValidationError(
        'Tenant slug may only contain lower-case letters, digits and hyphens (not at the ends)',
        { field: 'slug' },
      );
    }
    return normalized;
  }

  private static assertLogo(logo: Nullable<string> | undefined): Nullable<string> {
    if (logo === null || logo === undefined) {
      return null;
    }
    const trimmed = logo.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private static assertTaxId(taxId: Nullable<string> | undefined): Nullable<string> {
    if (taxId === null || taxId === undefined) {
      return null;
    }
    const trimmed = taxId.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private static assertLocale(
    value: string | undefined,
    field: string,
    fallback: string,
  ): string {
    if (value === undefined) {
      return fallback;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError(`Tenant ${field} must not be empty`, { field });
    }
    return value.trim();
  }

  private static toColor(value: BrandColor | string | null | undefined): Nullable<BrandColor> {
    if (value === null || value === undefined) {
      return null;
    }
    return value instanceof BrandColor ? value : BrandColor.create(value);
  }

  private static toTheme(value: Theme | string | undefined): Theme | undefined {
    if (value === undefined) {
      return undefined;
    }
    return value instanceof Theme ? value : Theme.create(value);
  }
}
