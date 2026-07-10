import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const request = require('supertest');

let createApp;

describe('createApp()', () => {
  it('builds a Fastify instance and exposes GET /healthz', async () => {
    createApp = require('../src/app').createApp;
    const app = createApp({ mongo: { ping: async () => {} } });
    await app.ready();
    const res = await request(app.server).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mongo: 'up' });
    await app.close();
  });

  it('returns 503 when mongo ping throws', async () => {
    createApp = require('../src/app').createApp;
    const fakeMongo = { ping: vi.fn().mockRejectedValue(new Error('mongo down')) };
    const app = createApp({ mongo: fakeMongo });
    await app.ready();
    const res = await request(app.server).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, mongo: 'down' });
    expect(fakeMongo.ping).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('exposes a Fastify plugin factory that returns a registerable function', () => {
    const healthPlugin = require('../src/routes/health');
    const fakeMongo = { ping: async () => {} };
    const plugin = healthPlugin(fakeMongo);
    expect(typeof plugin).toBe('function');
  });
});