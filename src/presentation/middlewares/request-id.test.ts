import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect } from 'vitest';
import { REQUEST_ID_HEADER, resolveRequestId, registerRequestId } from './request-id.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: (req) => resolveRequestId(req),
  });
  registerRequestId(app);
  app.get('/ping', (request) => ({ id: request.id }));
  return app;
}

describe('resolveRequestId', () => {
  it('reuses an inbound request id header', () => {
    expect(resolveRequestId({ headers: { [REQUEST_ID_HEADER]: 'incoming-123' } })).toBe(
      'incoming-123',
    );
  });

  it('uses the first value when the header is an array', () => {
    expect(resolveRequestId({ headers: { [REQUEST_ID_HEADER]: ['first', 'second'] } })).toBe(
      'first',
    );
  });

  it('generates a UUID when the header is absent', () => {
    expect(resolveRequestId({ headers: {} })).toMatch(UUID_RE);
  });

  it('generates a UUID when the header is blank', () => {
    expect(resolveRequestId({ headers: { [REQUEST_ID_HEADER]: '   ' } })).toMatch(UUID_RE);
  });
});

describe('request id propagation', () => {
  it('echoes an inbound request id back on the response', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { [REQUEST_ID_HEADER]: 'corr-789' },
    });
    expect(response.headers[REQUEST_ID_HEADER]).toBe('corr-789');
    expect(response.json()).toEqual({ id: 'corr-789' });
    await app.close();
  });

  it('generates and exposes a request id when none is provided', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/ping' });
    const headerId = response.headers[REQUEST_ID_HEADER];
    expect(typeof headerId).toBe('string');
    expect(headerId).toMatch(UUID_RE);
    expect(response.json()).toEqual({ id: headerId });
    await app.close();
  });
});
