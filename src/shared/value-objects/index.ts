/**
 * Shared, framework-agnostic value objects usable by any module.
 *
 * Kept dependency-free (beyond the domain base classes/errors) so the domain
 * layer of every module may import them (Clean Architecture, Requirement 3.2).
 */
export { Money, MONEY_DECIMAL_PLACES, CurrencyMismatchError } from './money.js';
