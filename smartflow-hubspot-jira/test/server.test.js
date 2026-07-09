import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const request = require('supertest');

let app;
let healthRouterFactory;
let webhooksRouterFactory;
let realMongo;
let mongod;

describe('createApp', () => {
  beforeAll(async () => {
    process.env.JIRA_BASE_URL = 'https://org.atlassian.net';
    process.env.JIRA_EMAIL = 'svc@example.com';
    process.env.JIRA_API_TOKEN = 'token-abc';
    process.env.JIRA_PROJECT_KEY = 'PROJ';
    process.env.HUBSPOT_TOKEN = 'pat-na1-test';
    process.env.WEBHOOK_SECRET = 'whsec-test';
    process.env.MONGO_URI = 'mongodb://localhost:27017/test_server';

    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    realMongo = require('../src/db/mongo');
    await realMongo.connect(mongod.getUri(), 'test_server');

    healthRouterFactory = require('../src/routes/health');
    webhooksRouterFactory = require('../src/routes/webhooks');
    const { createApp } = require('../src/server');
    app = createApp({
      mongo: realMongo,
      jira: { respondToIssue: () => {} },
      hubspot: { getTask: () => {}, updateTask: () => {} },
    });
  });

  it('GET /healthz returns 200 and ok status when mongo is up', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mongo: 'up' });
  });

  it('GET /healthz returns 503 when mongo ping throws', async () => {
    const fakeMongo = { ping: vi.fn().mockRejectedValue(new Error('boom')) };
    const { createApp } = require('../src/server');
    const localApp = createApp({
      mongo: fakeMongo,
      jira: { respondToIssue: () => {} },
      hubspot: { getTask: () => {}, updateTask: () => {} },
    });
    const res = await request(localApp).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, mongo: 'down' });
    expect(fakeMongo.ping).toHaveBeenCalledTimes(1);
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
  it('exports a factory that produces a router with a GET /healthz handler', () => {
    const factory = require('../src/routes/health');
    const router = factory({ mongo: { ping: async () => {} } });
    const stack = router.stack || [];
    const hasGet = stack.some(
      (layer) => layer.route && layer.route.path === '/healthz' && layer.route.methods.get
    );
    expect(hasGet).toBe(true);
  });
});

describe('routes/webhooks module', () => {
  it('exports a factory that produces a router with a POST / handler', () => {
    const factory = require('../src/routes/webhooks');
    const router = factory({
      secret: 's',
      jira: { respondToIssue: () => {} },
      hubspot: { getTask: () => {}, updateTask: () => {} },
    });
    const stack = router.stack || [];
    const hasPost = stack.some(
      (layer) => layer.route && layer.route.path === '/' && layer.route.methods.post
    );
    expect(hasPost).toBe(true);
  });

  it('throws when secret is missing', () => {
    const factory = require('../src/routes/webhooks');
    expect(() => factory({ jira: {}, hubspot: {} })).toThrow(/secret/);
  });

  it('throws when jira is missing', () => {
    const factory = require('../src/routes/webhooks');
    expect(() => factory({ secret: 's', hubspot: {} })).toThrow(/jira/);
  });

  it('throws when hubspot is missing', () => {
    const factory = require('../src/routes/webhooks');
    expect(() => factory({ secret: 's', jira: {} })).toThrow(/hubspot/);
  });
});
