import { NotFoundError } from '@domain/errors/index.js';
import type { ICustomerRepository } from '../../domain/repositories/customer-repository.js';
import {
  toCustomerOutput,
  type CustomerOutput,
  type GetCustomerInputDto,
} from '../dto/customer-dtos.js';

/**
 * Reads a single customer by id (Requirement 9.1).
 *
 * The customer is loaded by id and its tenant ownership is verified: a missing
 * (soft-deleted) customer or one owned by another tenant yields a 404 rather
 * than leaking cross-tenant existence (Requirement 1.5). This thin read use
 * case keeps the presentation layer free of repository access
 * (Clean Architecture, Requirement 3.2).
 */
export class GetCustomerUseCase {
  constructor(private readonly customers: ICustomerRepository) {}

  async execute(input: GetCustomerInputDto): Promise<CustomerOutput> {
    const customer = await this.customers.findById(input.id);
    if (customer === null || customer.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Customer', input.id);
    }
    return toCustomerOutput(customer);
  }
}
