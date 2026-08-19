import { describe, it, expect } from 'vitest';
import {
  runWithContext,
  enterContext,
  getContext,
  getRequestId,
  getTenantId,
  getUserId,
  setTenantId,
  setUserId,
} from './request-context.js';

describe('request context store', () => {
  it('returns undefined accessors outside of any request scope', () => {
    expect(getContext()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
    expect(getTenantId()).toBeUndefined();
    expect(getUserId()).toBeUndefined();
  });

  it('exposes the seeded request id within a scope', () => {
    runWithContext({ requestId: 'req-1' }, () => {
      expect(getRequestId()).toBe('req-1');
      expect(getContext()).toEqual({ requestId: 'req-1' });
    });
  });

  it('leaves tenant and user undefined until populated', () => {
    runWithContext({ requestId: 'req-2' }, () => {
      expect(getTenantId()).toBeUndefined();
      expect(getUserId()).toBeUndefined();
    });
  });

  it('allows tenant and user ids to be set within a scope', () => {
    runWithContext({ requestId: 'req-3' }, () => {
      setTenantId('tenant-abc');
      setUserId('user-xyz');
      expect(getTenantId()).toBe('tenant-abc');
      expect(getUserId()).toBe('user-xyz');
      expect(getContext()).toEqual({
        requestId: 'req-3',
        tenantId: 'tenant-abc',
        userId: 'user-xyz',
      });
    });
  });

  it('isolates context between sibling scopes', () => {
    runWithContext({ requestId: 'a' }, () => {
      setTenantId('tenant-a');
    });
    runWithContext({ requestId: 'b' }, () => {
      expect(getRequestId()).toBe('b');
      expect(getTenantId()).toBeUndefined();
    });
  });

  it('setTenantId/setUserId are no-ops outside a scope', () => {
    expect(() => {
      setTenantId('ignored');
      setUserId('ignored');
    }).not.toThrow();
    expect(getTenantId()).toBeUndefined();
  });

  it('enterContext binds context to the current async scope', () => {
    runWithContext({ requestId: 'outer' }, () => {
      enterContext({ requestId: 'inner' });
      expect(getRequestId()).toBe('inner');
    });
    // The scoped run restores the previous (empty) context on exit.
    expect(getContext()).toBeUndefined();
  });
});
