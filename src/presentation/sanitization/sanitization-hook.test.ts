import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, afterEach } from 'vitest';
import { registerInputSanitization } from './sanitization-hook.js';

/**
 * Builds a minimal app with the sanitization hook and an echo handler that
 * returns whatever `request.body` the handler actually sees. Because the hook
 * runs at `preValidation`, the handler observes the SANITIZED body.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerInputSanitization(app);
  app.post('/echo', (request) => ({ body: request.body }));
  app.get('/nobody', () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('registerInputSanitization', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it('sanitizes a malicious field before the handler sees it', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: {
        name: '<script>alert(document.cookie)</script>Acme',
        note: '<img src=x onerror=alert(1)>hi',
      },
    });

    expect(response.statusCode).toBe(200);
    const { body } = response.json() as { body: { name: string; note: string } };
    expect(body.name).toBe('Acme');
    expect(body.note).toBe('hi');
  });

  it('leaves legitimate business data unchanged', async () => {
    app = await buildApp();

    const payload = {
      company: 'Sancho & Co.',
      description: 'stock < 10 unidades',
      total: 1234.56,
      active: true,
    };

    const response = await app.inject({ method: 'POST', url: '/echo', payload });

    expect(response.json()).toEqual({ body: payload });
  });

  it('skips credential fields (password preserved verbatim)', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { email: 'user@example.com', password: 'P<ass>word!' },
    });

    const { body } = response.json() as { body: { password: string } };
    expect(body.password).toBe('P<ass>word!');
  });

  it('is a no-op when there is no object body', async () => {
    app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/nobody' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
