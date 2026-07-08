import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const request = require('supertest');

let app;
let mongoStub;
let healthRouter;
let webhooksRouter;
let realMongo;
let mongod;

describe('createApp', () => {
  beforeAll(async () => {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    realMongo = require('../src/db/mongo');
    await realMongo.connect(mongod.getUri(), 'test_server');
  });

  afterAll(async () => {
    await realMongo.close();
    await mongod.stop();
  });

  beforeAll(async () => {
    healthRouter = require('../src/routes/health');
    webhooksRouter = require('../src/routes/webhooks');
    const { createApp } = require('../src/server');
    app = createApp({ mongo: realMongo });
  });

  it('GET /healthz returns 200 and ok status when mongo is up', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mongo: 'up' });
  });

  it('GET /healthz returns 503 when mongo ping throws', async () => {
    const fakeMongo = { ping: vi.fn().mockRejectedValue(new Error('boom')) };
    const { createApp } = require('../src/server');
    const localApp = createApp({ mongo: fakeMongo });
    const res = await request(localApp).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, mongo: 'down' });
    expect(fakeMongo.ping).toHaveBeenCalledTimes(1);
  });

  it('POST /webhooks/hubspot returns 501 in Hito 1 (placeholder)', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .send({ taskId: 't1' });
    expect(res.status).toBe(501);
    expect(res.body).toEqual({ error: 'not implemented yet' });
  });

  it('rejects malformed JSON with 400 on the default json parser', async () => {
    const res = await request(app)
      .post('/some-json-endpoint')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
  });
});

describe('routes/health module', () => {
  it('exports a router with a GET /healthz handler', () => {
    expect(healthRouter).toBeDefined();
    const stack = healthRouter.stack || [];
    const hasGet = stack.some((layer) => layer.route && layer.route.path === '/healthz' && layer.route.methods.get);
    expect(hasGet).toBe(true);
  });
});

describe('routes/webhooks module', () => {
  it('exports a router that 501s (placeholder until F9)', async () => {
    const express = require('express');
    const localApp = express();
    localApp.use('/webhooks/hubspot', webhooksRouter);
    const res = await request(localApp)
      .post('/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(501);
  });
});
