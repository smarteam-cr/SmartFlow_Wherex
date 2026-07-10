import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let mongod;
let serverHandle;
let port;
let fetchMock;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function postJson(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
        timeout: 5000,
      },
      (r) => {
        let resp = '';
        r.on('data', (c) => (resp += c));
        r.on('end', () => resolve({ status: r.statusCode, body: resp }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const memUri = mongod.getUri();

  process.env.MONGO_URI = memUri;
  process.env.MONGO_DB_NAME = 'test_smoke';
  process.env.PORT = '0';
  process.env.POLL_INTERVAL_MIN = '5';

  process.env.JIRA_BASE_URL = 'https://org.atlassian.net';
  process.env.JIRA_EMAIL = 'svc@example.com';
  process.env.JIRA_API_TOKEN = 'token-abc';
  process.env.JIRA_PROJECT_KEY = 'PROJ';
  process.env.JIRA_HUBSPOT_TOKEN = 'pat-jira-test';
  process.env.JIRA_HUBSPOT_APP_SECRET = 'jira-smoke-secret';
  process.env.JIRA_HUBSPOT_PIPELINE_ID = 'pipeline-1';
  process.env.JIRA_HUBSPOT_STAGE_NEW_ID = 'stage-new';
  process.env.JIRA_HUBSPOT_STAGE_CLOSED_ID = 'stage-closed';

  process.env.SLACK_BOT_TOKEN = 'xoxb-smoke-token';
  process.env.SLACK_CHANNEL_ID = 'C0SMOKE';
  process.env.SLACK_HUBSPOT_TOKEN = 'pat-slack-test';
  process.env.SLACK_HUBSPOT_APP_SECRET = 'slack-smoke-secret';
  process.env.SLACK_HUBSPOT_PIPELINE_ID = '0';
  process.env.SLACK_HUBSPOT_STAGE_NEW_ID = '1';
  process.env.SLACK_HUBSPOT_STAGE_COMPLETED_ID = '4';

  fetchMock = vi.fn().mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/crm/v3/objects/tickets/') && u.includes('/search')) {
      return { ok: true, status: 200, json: async () => ({ total: 0, results: [] }), text: async () => '{"total":0,"results":[]}' };
    }
    if (u.includes('/rest/api/3/issue/')) {
      return { ok: true, status: 200, json: async () => ({ id: 'comment-smoke' }), text: async () => '{"id":"comment-smoke"}' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  });
  vi.stubGlobal('fetch', fetchMock);

  const cron = require('node-cron');
  vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() });

  Object.keys(require.cache).forEach((k) => {
    if (k.includes('/src/config/') || k.includes('/src/start.js') || k.includes('/src/db/connection.js')) {
      delete require.cache[k];
    }
  });

  const { start } = require('../src/start');
  const result = await start();
  serverHandle = result.app.server;
  port = serverHandle.address().port;
}, 60000);

afterAll(async () => {
  if (serverHandle) await new Promise((r) => serverHandle.close(r));
  vi.unstubAllGlobals();
  if (mongod) await mongod.stop();
}, 30000);

describe('smoke: unified process boots end-to-end', () => {
  it('exposes /healthz with status 200 and mongo:up after start', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, mongo: 'up' });
  });

  it('rejects unsigned POST /jira/webhooks/hubspot with 401', async () => {
    const res = await postJson('/jira/webhooks/hubspot', [{ objectId: 't1', subscriptionType: 'ticket.propertyChange' }]);
    expect(res.status).toBe(401);
  });

  it('rejects unsigned POST /slack/webhooks/hubspot with 401', async () => {
    const res = await postJson('/slack/webhooks/hubspot', [{ objectId: 't1', subscriptionType: 'ticket.propertyChange' }]);
    expect(res.status).toBe(401);
  });

  it('rejects Jira-signed payload at /slack/webhooks/hubspot with 401 (cross-isolation live)', async () => {
    const body = JSON.stringify([{ objectId: 't1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: 'stage-closed' }]);
    const res = await postJson('/slack/webhooks/hubspot', body, {
      'x-hubspot-signature': crypto.createHash('sha256').update('jira-smoke-secret' + body).digest('hex'),
    });
    expect(res.status).toBe(401);
  });

  it('rejects Slack-signed payload at /jira/webhooks/hubspot with 401 (cross-isolation live)', async () => {
    const body = JSON.stringify([{ objectId: 't1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: '4' }]);
    const res = await postJson('/jira/webhooks/hubspot', body, {
      'x-hubspot-signature': crypto.createHash('sha256').update('slack-smoke-secret' + body).digest('hex'),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid Jira-signed webhook at /jira/webhooks/hubspot and returns 200', async () => {
    const body = JSON.stringify([{
      objectId: 'ticket-jira-smoke',
      subscriptionType: 'ticket.propertyChange',
      propertyName: 'hs_pipeline_stage',
      propertyValue: 'stage-closed',
    }]);
    const res = await postJson('/jira/webhooks/hubspot', body, {
      'x-hubspot-signature': crypto.createHash('sha256').update('jira-smoke-secret' + body).digest('hex'),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('returns 404 on unknown routes under both prefixes', async () => {
    const r1 = await postJson('/jira/webhooks/unknown', []);
    expect(r1.status).toBe(404);
    const r2 = await postJson('/slack/webhooks/unknown', []);
    expect(r2.status).toBe(404);
  });
});