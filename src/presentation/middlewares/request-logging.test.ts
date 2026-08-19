import Fastify, { type FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { registerRequestLogging } from './request-logging.js';
import { registerRequestContext } from './request-context.js';
import { setTenantId, setUserId } from '@common/context';

interface LogEntry {
  msg?: string;
  request_id?: string;
  tenant_id?: string | null;
  user_id?: string | null;
  method?: string;
  path?: string;
  status_code?: number;
  duration?: number;
}

function buildApp(lines: string[]): FastifyInstance {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = Fastify({ logger: { level: 'info', stream } });
  registerRequestContext(app);
  registerRequestLogging(app);

  app.get('/ok', () => {
    setTenantId('tenant-1');
    setUserId('user-1');
    return { ok: true };
  });
  app.get('/plain', () => ({ ok: true }));
  return app;
}

function parseRequestLog(lines: string[]): LogEntry | undefined {
  return lines
    .join('')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LogEntry)
    .find((entry) => entry.msg === 'request completed' && entry.request_id !== undefined);
}

describe('request logging', () => {
  it('logs the structured fields required by observability', async () => {
    const lines: string[] = [];
    const app = buildApp(lines);

    const response = await app.inject({ method: 'GET', url: '/ok' });
    expect(response.statusCode).toBe(200);

    const entry = parseRequestLog(lines);
    expect(entry).toBeDefined();
    expect(typeof entry?.request_id).toBe('string');
    expect(entry?.tenant_id).toBe('tenant-1');
    expect(entry?.user_id).toBe('user-1');
    expect(entry?.method).toBe('GET');
    expect(entry?.path).toBe('/ok');
    expect(entry?.status_code).toBe(200);
    expect(typeof entry?.duration).toBe('number');
    expect(entry?.duration).toBeGreaterThanOrEqual(0);

    await app.close();
  });

  it('logs null tenant/user when the context is not yet populated', async () => {
    const lines: string[] = [];
    const app = buildApp(lines);

    await app.inject({ method: 'GET', url: '/plain' });

    const entry = parseRequestLog(lines);
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBeNull();
    expect(entry?.user_id).toBeNull();
    expect(entry?.path).toBe('/plain');

    await app.close();
  });
});
