import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const http = require('http');

let mongod;
let serverHandle;

async function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

describe('smoke: npm start end-to-end', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const memUri = mongod.getUri();

    process.env.JIRA_BASE_URL = 'https://org.atlassian.net';
    process.env.JIRA_EMAIL = 'svc@example.com';
    process.env.JIRA_API_TOKEN = 'token-abc';
    process.env.JIRA_PROJECT_KEY = 'PROJ';
    process.env.HUBSPOT_TOKEN = 'pat-na1-test';
    process.env.WEBHOOK_SECRET = 'whsec-smoke';
    process.env.MONGO_URI = memUri;
    process.env.PORT = '0'; // OS-assigned

    // Silence the cron and node-cron
    const cron = require('node-cron');
    vi.spyOn(cron, 'schedule').mockReturnValue({ stop: vi.fn() });

    // Delete any cached config/server so the env above is picked up
    Object.keys(require.cache).forEach((k) => {
      if (k.includes(`${require('path').sep}src${require('path').sep}config.js`)) delete require.cache[k];
      if (k.includes(`${require('path').sep}src${require('path').sep}server.js`)) delete require.cache[k];
      if (k.includes(`${require('path').sep}src${require('path').sep}db${require('path').sep}mongo.js`)) delete require.cache[k];
    });

    const { start } = require('../src/server');
    serverHandle = await start();
  }, 30000);

  afterAll(async () => {
    if (serverHandle && serverHandle.close) {
      await new Promise((r) => serverHandle.close(r));
    }
    if (mongod) await mongod.stop();
  }, 15000);

  it('exposes /healthz with status 200 and mongo:up after start', async () => {
    const port = serverHandle.address().port;
    const res = await get(port, '/healthz');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, mongo: 'up' });
  });

  it('rejects unauthenticated POST /webhooks/hubspot with 401', async () => {
    const port = serverHandle.address().port;
    const res = await new Promise((resolve, reject) => {
      const data = JSON.stringify({ objectId: 'task-1' });
      const req = http.request(
        {
          port,
          path: '/webhooks/hubspot',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
          timeout: 2000,
        },
        (r) => {
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => resolve({ status: r.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
    expect(res.status).toBe(401);
  });
});
