/**
 * Re-export shim for the Products module.
 *
 * `Money` was promoted to the shared kernel (`@shared/value-objects/money.js`)
 * because it is genuinely shared domain math used by Products, Sales and later
 * Purchases/Cash. This file preserves the module's historical public path so
 * existing relative imports (`../value-objects/money.js`) and the module barrel
 * keep working unchanged.
 */
export { Money, MONEY_DECIMAL_PLACES, CurrencyMismatchError } from '@shared/value-objects/money.js';
