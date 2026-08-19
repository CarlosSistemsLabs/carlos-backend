import { describe, it, expect } from 'vitest';
import { UnauthorizedError } from '@domain/errors';
import { runWithContext } from './request-context.js';
import { requireTenantId, requireUserId } from './require-context.js';

describe('requireTenantId', () => {
  it('throws UnauthorizedError when called outside any request context', () => {
    expect(() => requireTenantId()).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when the context has no tenant id', () => {
    runWithContext({ requestId: 'req-1' }, () => {
      expect(() => requireTenantId()).toThrow(UnauthorizedError);
    });
  });

  it('throws UnauthorizedError when the tenant id is an empty string', () => {
    runWithContext({ requestId: 'req-1', tenantId: '' }, () => {
      expect(() => requireTenantId()).toThrow(UnauthorizedError);
    });
  });

  it('returns the tenant id when present in the context', () => {
    runWithContext({ requestId: 'req-1', tenantId: 'tenant-123' }, () => {
      expect(requireTenantId()).toBe('tenant-123');
    });
  });
});

describe('requireUserId', () => {
  it('throws UnauthorizedError when called outside any request context', () => {
    expect(() => requireUserId()).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when the context has no user id', () => {
    runWithContext({ requestId: 'req-1' }, () => {
      expect(() => requireUserId()).toThrow(UnauthorizedError);
    });
  });

  it('returns the user id when present in the context', () => {
    runWithContext({ requestId: 'req-1', userId: 'user-456' }, () => {
      expect(requireUserId()).toBe('user-456');
    });
  });
});
