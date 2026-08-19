import { randomUUID } from 'node:crypto';
import type { UUID } from '@shared/types/index.js';

/**
 * Base class for all domain entities.
 *
 * Entities have a stable identity ({@link Entity.id}) that does not change over
 * their lifetime. Two entities are considered equal when they share the same
 * identity, regardless of their attribute values.
 *
 * @typeParam TProps - The shape of the entity's attributes.
 */
export abstract class Entity<TProps> {
  protected readonly _id: UUID;
  protected readonly props: TProps;

  /**
   * @param props - The entity attributes.
   * @param id - Optional identity. A new UUID is generated when omitted.
   */
  protected constructor(props: TProps, id?: UUID) {
    this._id = id ?? randomUUID();
    this.props = props;
  }

  /** The entity's stable unique identity. */
  public get id(): UUID {
    return this._id;
  }

  /**
   * Identity-based equality. Returns `true` when `other` is an entity with the
   * same id.
   */
  public equals(other?: Entity<TProps> | null): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    if (this === other) {
      return true;
    }
    if (!(other instanceof Entity)) {
      return false;
    }
    return this._id === other._id;
  }
}
