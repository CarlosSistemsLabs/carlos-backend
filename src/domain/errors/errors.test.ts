import { describe, it, expect } from 'vitest';
import { DomainError } from './domain-error.js';
import { ErrorCode } from './error-codes.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BusinessRuleError,
  RateLimitError,
  InternalError,
} from './errors.js';

describe('Domain error hierarchy', () => {
  const cases = [
    { Ctor: ValidationError, code: ErrorCode.VALIDATION, status: 400 },
    { Ctor: NotFoundError, code: ErrorCode.NOT_FOUND, status: 404 },
    { Ctor: ConflictError, code: ErrorCode.CONFLICT, status: 409 },
    { Ctor: UnauthorizedError, code: ErrorCode.UNAUTHORIZED, status: 401 },
    { Ctor: ForbiddenError, code: ErrorCode.FORBIDDEN, status: 403 },
    { Ctor: BusinessRuleError, code: ErrorCode.BUSINESS_RULE, status: 422 },
    { Ctor: RateLimitError, code: ErrorCode.RATE_LIMITED, status: 429 },
    { Ctor: InternalError, code: ErrorCode.INTERNAL, status: 500 },
  ] as const;

  for (const { Ctor, code, status } of cases) {
    it(`${Ctor.name} extends DomainError and Error`, () => {
      const error = new Ctor();
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
    });

    it(`${Ctor.name} carries the correct code and http status`, () => {
      const error = new Ctor();
      expect(error.code).toBe(code);
      expect(error.httpStatus).toBe(status);
    });

    it(`${Ctor.name} sets name to the concrete class name`, () => {
      const error = new Ctor();
      expect(error.name).toBe(Ctor.name);
    });

    it(`${Ctor.name} is throwable and catchable as DomainError`, () => {
      let caught: unknown;
      try {
        throw new Ctor('boom');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainError);
    });
  }

  it('preserves custom messages and details', () => {
    const error = new ValidationError('bad input', { field: 'email' });
    expect(error.message).toBe('bad input');
    expect(error.details).toEqual({ field: 'email' });
  });

  it('leaves details undefined when not provided', () => {
    const error = new ConflictError();
    expect(error.details).toBeUndefined();
  });

  it('NotFoundError.forEntity builds a descriptive error', () => {
    const error = NotFoundError.forEntity('Product', 'abc-123');
    expect(error.message).toContain('Product');
    expect(error.message).toContain('abc-123');
    expect(error.details).toEqual({ entity: 'Product', id: 'abc-123' });
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
  });
});
