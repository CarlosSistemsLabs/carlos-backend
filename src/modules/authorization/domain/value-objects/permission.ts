import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/**
 * Wildcard segment that matches any value for a permission dimension.
 *
 * A permission whose `module`, `screen` or `action` equals this value grants
 * access to every concrete value of that dimension. This keeps the system
 * "Admin" role to a single wildcard row (module, screen and action all `*`)
 * instead of enumerating the full module × screen × action cartesian product
 * (see the system role matrix).
 */
export const PERMISSION_WILDCARD = '*';

/**
 * Plain, serialisable representation of a permission.
 *
 * Designed to be embedded directly in a JWT payload (Requirement 8.4) and
 * consumed by the authorization middleware (task 9.2). It is a structural
 * subset of the `Permission` value object with no behaviour.
 */
export interface PermissionDescriptor {
  module: string;
  screen: string;
  action: string;
}

/** Internal attributes of a {@link Permission}. */
type PermissionProps = PermissionDescriptor;

/**
 * Permission value object.
 *
 * Models a single RBAC grant scoped to a `module`, a `screen` and an `action`
 * (Requirement 8.4 — "permissions per module/screen/action"). Permissions are
 * immutable and compared by value, so two permissions describing the same
 * triple are equal. Each segment may be the {@link PERMISSION_WILDCARD} `*` to
 * match any value of that dimension.
 *
 * The value object intentionally accepts any non-empty segment string rather
 * than constraining to the known module/action catalogue: it stays decoupled
 * from the catalogue so callers (and future modules) can introduce new screens
 * without touching the domain primitive. Callers that want validation against
 * known values should use the constants in `permission-catalog.ts`.
 */
export class Permission extends ValueObject<PermissionProps> {
  private constructor(props: PermissionProps) {
    super(props);
  }

  /**
   * Creates a validated {@link Permission}.
   *
   * @throws {ValidationError} when any segment is empty or not a string.
   */
  static create(module: string, screen: string, action: string): Permission {
    return new Permission({
      module: Permission.normalizeSegment(module, 'module'),
      screen: Permission.normalizeSegment(screen, 'screen'),
      action: Permission.normalizeSegment(action, 'action'),
    });
  }

  /** Creates a {@link Permission} from its serialisable descriptor form. */
  static fromDescriptor(descriptor: PermissionDescriptor): Permission {
    return Permission.create(descriptor.module, descriptor.screen, descriptor.action);
  }

  private static normalizeSegment(value: string, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError(`Permission ${field} is required`, { field });
    }
    return value.trim().toLowerCase();
  }

  get module(): string {
    return this.props.module;
  }

  get screen(): string {
    return this.props.screen;
  }

  get action(): string {
    return this.props.action;
  }

  /** Returns `true` when every segment is the wildcard (a full Admin grant). */
  isWildcard(): boolean {
    return (
      this.props.module === PERMISSION_WILDCARD &&
      this.props.screen === PERMISSION_WILDCARD &&
      this.props.action === PERMISSION_WILDCARD
    );
  }

  /**
   * Returns `true` when this permission grants the requested
   * `module`/`screen`/`action`, honouring wildcards on each dimension.
   *
   * A held segment of {@link PERMISSION_WILDCARD} matches any requested value;
   * otherwise the segments must be equal (case-insensitively, as inputs are
   * normalised on creation).
   */
  matches(module: string, screen: string, action: string): boolean {
    return (
      Permission.segmentMatches(this.props.module, module) &&
      Permission.segmentMatches(this.props.screen, screen) &&
      Permission.segmentMatches(this.props.action, action)
    );
  }

  private static segmentMatches(held: string, requested: string): boolean {
    return held === PERMISSION_WILDCARD || held === requested.trim().toLowerCase();
  }

  /** Returns the plain, JWT-embeddable descriptor for this permission. */
  toDescriptor(): PermissionDescriptor {
    return { module: this.props.module, screen: this.props.screen, action: this.props.action };
  }

  /** Stable `module:screen:action` string form, useful for logging/keys. */
  override toString(): string {
    return `${this.props.module}:${this.props.screen}:${this.props.action}`;
  }
}
