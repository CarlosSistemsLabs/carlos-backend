import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { describe, it, expect } from 'vitest';
import { validate, validateBody, validateQuery, validateParams } from './validate.js';
import { ValidationError } from '@domain/errors';

const userSchema = z.object({
  name: z.string(),
  age: z.number().int().positive(),
});

describe('validate', () => {
  it('returns the typed value on success', () => {
    const result = validate(userSchema, { name: 'Ada', age: 36 });
    expect(result).toEqual({ name: 'Ada', age: 36 });
  });

  it('throws a ValidationError on failure', () => {
    expect(() => validate(userSchema, { name: 'Ada' })).toThrow(ValidationError);
  });

  it('reports field-level messages in details.fields', () => {
    try {
      validate(userSchema, { name: 123, age: -1 });
      expect.unreachable('validate should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const details = (error as ValidationError).details as {
        fields: Array<{ field: string; message: string }>;
      };
      const fields = details.fields.map((f) => f.field);
      expect(fields).toContain('name');
      expect(fields).toContain('age');
    }
  });

  it('joins nested field paths with a dot', () => {
    const nested = z.object({ profile: z.object({ email: z.string().email() }) });
    try {
      validate(nested, { profile: { email: 'not-an-email' } });
      expect.unreachable('validate should have thrown');
    } catch (error) {
      const details = (error as ValidationError).details as {
        fields: Array<{ field: string }>;
      };
      expect(details.fields[0]?.field).toBe('profile.email');
    }
  });
});

describe('request-scoped validators', () => {
  it('validateBody parses the request body', () => {
    const request = { body: { name: 'Lin', age: 42 } } as FastifyRequest;
    expect(validateBody(request, userSchema)).toEqual({ name: 'Lin', age: 42 });
  });

  it('validateQuery parses the request query', () => {
    const schema = z.object({ q: z.string() });
    const request = { query: { q: 'search' } } as FastifyRequest;
    expect(validateQuery(request, schema)).toEqual({ q: 'search' });
  });

  it('validateParams parses the route params', () => {
    const schema = z.object({ id: z.string() });
    const request = { params: { id: 'abc' } } as FastifyRequest;
    expect(validateParams(request, schema)).toEqual({ id: 'abc' });
  });

  it('validateBody throws ValidationError on invalid body', () => {
    const request = { body: {} } as FastifyRequest;
    expect(() => validateBody(request, userSchema)).toThrow(ValidationError);
  });
});
