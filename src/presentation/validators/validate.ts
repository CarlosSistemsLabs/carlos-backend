import type { FastifyRequest } from 'fastify';
import type { ZodType, ZodTypeDef } from 'zod';
import { ValidationError } from '@domain/errors';

/**
 * Parses `data` against a Zod `schema`, returning the typed, validated value.
 *
 * On failure throws a domain {@link ValidationError} carrying field-level
 * messages in `details.fields`. The error handler middleware translates this
 * into the consistent response envelope, satisfying Requirement 3.6 (validate
 * all inputs using Zod) without leaking framework concerns into the domain.
 */
export function validate<Output, Input = Output>(
  schema: ZodType<Output, ZodTypeDef, Input>,
  data: unknown,
): Output {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ValidationError('Validation failed', { fields });
  }
  return result.data;
}

/** Validates and returns the request body against `schema`. */
export function validateBody<Output, Input = Output>(
  request: FastifyRequest,
  schema: ZodType<Output, ZodTypeDef, Input>,
): Output {
  return validate(schema, request.body);
}

/** Validates and returns the request query string against `schema`. */
export function validateQuery<Output, Input = Output>(
  request: FastifyRequest,
  schema: ZodType<Output, ZodTypeDef, Input>,
): Output {
  return validate(schema, request.query);
}

/** Validates and returns the request route params against `schema`. */
export function validateParams<Output, Input = Output>(
  request: FastifyRequest,
  schema: ZodType<Output, ZodTypeDef, Input>,
): Output {
  return validate(schema, request.params);
}
