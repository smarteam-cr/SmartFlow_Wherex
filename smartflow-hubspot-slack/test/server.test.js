import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const request = require('supertest');

let app;

beforeAll(() => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_CHANNEL_ID = 'C0TEST';
  process.env.HUBSPOT_TOKEN = 'pat-na1-test';
  process.env.HS_PIPELINE_ID = '0';
  process.env.HS_STAGE_NEW_ID = '1';
  process.env.HS_STAGE_COMPLETED_ID = '4';
  process.env.HUBSPOT_APP_SECRET = 'test-app-secret';
  process.env.MONGO_URI = 'mongodb://localhost:27017/test_server';

  const { createApp } = require('../src/server');
  app = createApp();
});

describe('GET /health', () => {
  it('responds with 200 and ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
