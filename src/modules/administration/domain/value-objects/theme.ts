import { ValueObject } from '@domain/value-objects/value-object.js';
import { ValidationError } from '@domain/errors/index.js';

/** The two supported UI themes for a tenant (Requirement 11.1). */
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
} as const;

/** Union of the supported theme identifiers. */
export type ThemeName = (typeof THEMES)[keyof typeof THEMES];

/** Every accepted theme value, used for validation. */
const THEME_VALUES: ReadonlySet<string> = new Set<string>(Object.values(THEMES));

/** Internal attributes of a {@link Theme}. */
interface ThemeProps {
  value: ThemeName;
}

/**
 * Theme value object (Administration module — Requirement 11.1).
 *
 * A constrained enum of `light` | `dark`. Input is trimmed + lower-cased before
 * validation so casing/whitespace variations (`"LIGHT"`, `" dark "`) normalise
 * to a canonical value. The schema default is `light`.
 */
export class Theme extends ValueObject<ThemeProps> {
  private constructor(props: ThemeProps) {
    super(props);
  }

  /**
   * Creates a validated {@link Theme}.
   *
   * @throws {ValidationError} when the value is not one of the supported themes.
   */
  static create(value: string): Theme {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ValidationError('Theme is required', { field: 'theme' });
    }

    const normalized = value.trim().toLowerCase();

    if (!THEME_VALUES.has(normalized)) {
      throw new ValidationError('Theme must be one of "light" or "dark"', {
        field: 'theme',
        value,
      });
    }

    return new Theme({ value: normalized as ThemeName });
  }

  /** The canonical light theme. */
  static light(): Theme {
    return new Theme({ value: THEMES.LIGHT });
  }

  /** The canonical dark theme. */
  static dark(): Theme {
    return new Theme({ value: THEMES.DARK });
  }

  /** The normalised theme identifier (`light` | `dark`). */
  get value(): ThemeName {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
