import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import type { Money } from '../value-objects/money.js';
import { Sku } from '../value-objects/sku.js';
import { InvalidCostError, InvalidPriceError } from '../errors/product-errors.js';

/** Default unit of measure when none is supplied. */
export const DEFAULT_PRODUCT_UNIT = 'unit';

/** Inclusive bounds for a product tax rate, expressed as a percentage. */
export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 100;

/** Attributes describing a sellable product. */
export interface ProductProps {
  tenantId: UUID;
  categoryId: UUID;
  sku: Sku;
  name: string;
  description: Nullable<string>;
  price: Money;
  cost: Nullable<Money>;
  /** Tax rate as a percentage in the inclusive range [0, 100]. */
  taxRate: number;
  unit: string;
  /** Minimum stock threshold used for low-stock alerts. Non-negative integer. */
  minStock: number;
  isActive: boolean;
  imageUrl: Nullable<string>;
}

/** Input accepted by {@link Product.create} when defining a new product. */
export interface CreateProductInput {
  tenantId: UUID;
  categoryId: UUID;
  sku: Sku | string;
  name: string;
  price: Money;
  description?: Nullable<string>;
  cost?: Nullable<Money>;
  taxRate?: number;
  unit?: string;
  minStock?: number;
  isActive?: boolean;
  imageUrl?: Nullable<string>;
}

/**
 * Product aggregate root (Requirement 9.1).
 *
 * Encapsulates the business rules for a catalogue product: a price strictly
 * greater than zero, a non-negative cost, a tax rate within `[0, 100]` and a
 * non-negative minimum-stock threshold. Monetary fields use the {@link Money}
 * value object so currency and precision are handled consistently.
 *
 * **SKU uniqueness invariant:** a product's {@link sku} must be unique *per
 * tenant* (`@@unique([tenantId, sku])`). That invariant spans multiple
 * aggregates, so it is enforced at the use-case/repository level (task 13.2);
 * the entity guarantees only that the SKU itself is well-formed.
 */
export class Product extends AggregateRoot<ProductProps> {
  private constructor(props: ProductProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Defines a brand new, active-by-default product, validating every invariant.
   *
   * @throws {InvalidPriceError} when `price` is not strictly positive.
   * @throws {InvalidCostError} when `cost` is negative.
   * @throws {ValidationError} when the name, tax rate, unit or minimum stock is
   *   invalid.
   */
  static create(input: CreateProductInput, id?: UUID): Product {
    const name = Product.assertName(input.name);
    Product.assertPrice(input.price);
    if (input.cost !== null && input.cost !== undefined) {
      Product.assertCost(input.cost);
    }
    const taxRate = Product.assertTaxRate(input.taxRate ?? 0);
    const minStock = Product.assertMinStock(input.minStock ?? 0);
    const unit = Product.assertUnit(input.unit ?? DEFAULT_PRODUCT_UNIT);
    const sku = input.sku instanceof Sku ? input.sku : Sku.create(input.sku);

    return new Product(
      {
        tenantId: input.tenantId,
        categoryId: input.categoryId,
        sku,
        name,
        description: input.description ?? null,
        price: input.price,
        cost: input.cost ?? null,
        taxRate,
        unit,
        minStock,
        isActive: input.isActive ?? true,
        imageUrl: input.imageUrl ?? null,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Product} from already-validated persisted state. Trusts
   * the data store and performs no re-validation, mirroring the other module
   * aggregates.
   */
  static reconstitute(id: UUID, props: ProductProps): Product {
    return new Product({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get categoryId(): UUID {
    return this.props.categoryId;
  }

  get sku(): Sku {
    return this.props.sku;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): Nullable<string> {
    return this.props.description;
  }

  get price(): Money {
    return this.props.price;
  }

  get cost(): Nullable<Money> {
    return this.props.cost;
  }

  get taxRate(): number {
    return this.props.taxRate;
  }

  get unit(): string {
    return this.props.unit;
  }

  get minStock(): number {
    return this.props.minStock;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get imageUrl(): Nullable<string> {
    return this.props.imageUrl;
  }

  /**
   * Returns `true` when `currentQuantity` is at or below the configured
   * {@link minStock} threshold, signalling a low-stock alert should fire.
   */
  isLowStock(currentQuantity: number): boolean {
    return currentQuantity <= this.props.minStock;
  }

  /** Marks the product active so it can be sold/listed. */
  activate(): void {
    this.props.isActive = true;
  }

  /** Marks the product inactive, hiding it from sales/listings. */
  deactivate(): void {
    this.props.isActive = false;
  }

  /**
   * Updates the selling price.
   *
   * @throws {InvalidPriceError} when the new price is not strictly positive.
   */
  updatePrice(price: Money): void {
    Product.assertPrice(price);
    this.props.price = price;
  }

  /**
   * Updates (or clears, with `null`) the unit cost.
   *
   * @throws {InvalidCostError} when the new cost is negative.
   */
  updateCost(cost: Nullable<Money>): void {
    if (cost !== null) {
      Product.assertCost(cost);
    }
    this.props.cost = cost;
  }

  /**
   * Renames the product.
   *
   * @throws {ValidationError} when the new name is empty.
   */
  rename(name: string): void {
    this.props.name = Product.assertName(name);
  }

  /** Moves the product to a different category. */
  changeCategory(categoryId: UUID): void {
    this.props.categoryId = categoryId;
  }

  /**
   * Returns the selling price with tax applied, i.e.
   * `price * (1 + taxRate / 100)`, rounded to the nearest minor unit.
   */
  computePriceWithTax(): Money {
    const taxAmount = this.props.price.multiply(this.props.taxRate / 100);
    return this.props.price.add(taxAmount);
  }

  private static assertName(name: string): string {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Product name is required', { name });
    }
    return name.trim();
  }

  private static assertPrice(price: Money): void {
    if (!price.isPositive()) {
      throw new InvalidPriceError(price.toDecimalString());
    }
  }

  private static assertCost(cost: Money): void {
    if (cost.isNegative()) {
      throw new InvalidCostError(cost.toDecimalString());
    }
  }

  private static assertTaxRate(taxRate: number): number {
    if (!Number.isFinite(taxRate) || taxRate < MIN_TAX_RATE || taxRate > MAX_TAX_RATE) {
      throw new ValidationError(`Tax rate must be between ${MIN_TAX_RATE} and ${MAX_TAX_RATE}`, {
        taxRate,
      });
    }
    return taxRate;
  }

  private static assertMinStock(minStock: number): number {
    if (!Number.isInteger(minStock) || minStock < 0) {
      throw new ValidationError('Minimum stock must be a non-negative integer', { minStock });
    }
    return minStock;
  }

  private static assertUnit(unit: string): string {
    if (typeof unit !== 'string' || unit.trim().length === 0) {
      throw new ValidationError('Unit is required', { unit });
    }
    return unit.trim();
  }
}
