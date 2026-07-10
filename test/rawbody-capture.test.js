import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const request = require('supertest');
const Fastify = require('fastify');

describe('raw body capture for HMAC verification', () => {
  it('installs an application/json content type parser that exposes req.rawBody as a Buffer', async () => {
    const { installRawBodyParser } = require('../src/app');
    const app = Fastify();
    installRawBodyParser(app);
    app.post('/echo', async (req, reply) => {
      expect(Buffer.isBuffer(req.rawBody)).toBe(true);
      return { rawBody: req.rawBody.toString('utf8'), parsed: req.body };
    });
    await app.ready();
    const payload = JSON.stringify({ event: 'ticket.propertyChange', id: 42 });
    const res = await request(app.server)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.rawBody).toBe(payload);
    expect(res.body.parsed).toEqual({ event: 'ticket.propertyChange', id: 42 });
    await app.close();
  });

  it('preserves exact byte content (key for HMAC calculation)', async () => {
    const { installRawBodyParser } = require('../src/app');
    const app = Fastify();
    installRawBodyParser(app);
    let captured;
    app.post('/echo', async (req, reply) => {
      captured = req.rawBody;
      return { ok: true };
    });
    await app.ready();
    const payload = '{"a":1,"b":"x","c":[1,2,3]}';
    const res = await request(app.server)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(200);
    expect(captured.toString('utf8')).toBe(payload);
    expect(captured.toString('utf8').length).toBe(payload.length);
    await app.close();
  });

  it('handles empty JSON body as empty object (no crash)', async () => {
    const { installRawBodyParser } = require('../src/app');
    const app = Fastify();
    installRawBodyParser(app);
    let captured;
    app.post('/echo', async (req, reply) => {
      captured = req.rawBody;
      return { ok: true, parsed: req.body };
    });
    await app.ready();
    const res = await request(app.server)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('');
    expect(res.status).toBe(200);
    expect(captured.length).toBe(0);
    expect(res.body.parsed).toEqual({});
    await app.close();
  });

  it('rejects malformed JSON with HTTP 400', async () => {
    const { installRawBodyParser } = require('../src/app');
    const app = Fastify();
    installRawBodyParser(app);
    app.post('/echo', async (req, reply) => ({ ok: true }));
    await app.ready();
    const res = await request(app.server)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{not-json');
    expect(res.status).toBe(400);
    await app.close();
  });
});