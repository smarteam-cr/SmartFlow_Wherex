import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const request = require('supertest');

let mongod;
let connection;
let createJiraService;
let createHubSpotService;
let createSlackService;
let createSlackHubSpotService;
let buildJiraWebhooksRouter;
let buildSlackWebhooksRouter;
let createApp;

const JIRA_SECRET = 'jira-app-secret';
const SLACK_SECRET = 'slack-app-secret';
const PIPELINE_ID = 'pipeline-1';
const STAGE_NEW_ID = 'stage-new';
const STAGE_CLOSED_ID = 'stage-closed';
const SLACK_PIPELINE_ID = '0';
const SLACK_STAGE_NEW_ID = '1';
const SLACK_STAGE_COMPLETED_ID = '4';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  connection = require('../../src/db/connection');
  await connection.connect(mongod.getUri(), 'test_app_iso');

  createJiraService = require('../../src/modules/jira/services/jira');
  createHubSpotService = require('../../src/modules/jira/services/hubspot');
  createSlackService = require('../../src/modules/slack/services/slack').createSlackService;
  createSlackHubSpotService = require('../../src/modules/slack/services/hubspot');
  buildJiraWebhooksRouter = require('../../src/routes/jira/webhooks').buildJiraWebhooksRouter;
  buildSlackWebhooksRouter = require('../../src/routes/slack/webhooks').buildSlackWebhooksRouter;
  ({ createApp } = require('../../src/app'));
}, 30000);

afterAll(async () => {
  await connection.close();
  await mongod.stop();
});

function signV1(secret, body) {
  return crypto.createHash('sha256').update(secret + body).digest('hex');
}

function buildBothApp() {
  const jiraHubspot = createHubSpotService({
    token: 'pat-jira',
    jiraBaseUrl: 'https://org.atlassian.net',
    pipelineId: PIPELINE_ID,
    newStageId: STAGE_NEW_ID,
    withRetry: (fn) => fn(),
  });
  const jira = createJiraService({
    baseUrl: 'https://org.atlassian.net',
    email: 'svc@example.com',
    apiToken: 'token-abc',
    withRetry: (fn) => fn(),
  });
  const slackHubspot = createSlackHubSpotService({
    token: 'pat-slack',
    pipelineId: SLACK_PIPELINE_ID,
    stageNewId: SLACK_STAGE_NEW_ID,
    stageCompletedId: SLACK_STAGE_COMPLETED_ID,
  });
  const slack = createSlackService({
    client: {
      auth: { test: async () => ({ bot_id: 'B_OWN' }) },
      conversations: { history: async () => ({ messages: [], response_metadata: {} }) },
      chat: { postMessage: async () => ({}) },
      users: { info: async () => ({ user: { real_name: 'X' } }) },
    },
  });

  const jiraWebhooks = buildJiraWebhooksRouter({
    appSecret: JIRA_SECRET,
    closedStageId: STAGE_CLOSED_ID,
    jira,
    hubspot: jiraHubspot,
    transitionDoneId: '31',
  });
  const slackWebhooks = buildSlackWebhooksRouter({
    appSecret: SLACK_SECRET,
    stageCompletedId: SLACK_STAGE_COMPLETED_ID,
    slack,
    hubspot: slackHubspot,
  });
  return createApp({
    mongo: connection,
    jira: { webhooks: jiraWebhooks },
    slack: { webhooks: slackWebhooks },
  });
}

describe('app integration: cross-integration isolation', () => {
  let app;

  beforeEach(async () => {
    if (app) await app.close();
    app = buildBothApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('rejects a Slack-signed payload sent to /jira/webhooks/hubspot', async () => {
    const body = JSON.stringify([{ objectId: 't1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: STAGE_CLOSED_ID }]);
    const res = await request(app.server)
      .post('/jira/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(SLACK_SECRET, body))
      .send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a Jira-signed payload sent to /slack/webhooks/hubspot', async () => {
    const body = JSON.stringify([{ objectId: 't1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: SLACK_STAGE_COMPLETED_ID }]);
    const res = await request(app.server)
      .post('/slack/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(JIRA_SECRET, body))
      .send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a body tampered after signing on /jira/webhooks/hubspot', async () => {
    const body = JSON.stringify([{ objectId: 't1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: STAGE_CLOSED_ID }]);
    const tampered = JSON.stringify([{ objectId: 't1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: 'wrong-stage' }]);
    const res = await request(app.server)
      .post('/jira/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(JIRA_SECRET, body))
      .send(tampered);
    expect(res.status).toBe(401);
  });

  it('serves /healthz regardless of which integrations are configured', async () => {
    const res = await request(app.server).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mongo: 'up' });
  });

  it('returns 404 for unknown paths under both prefixes', async () => {
    const res1 = await request(app.server).post('/jira/webhooks/unknown').send({});
    expect(res1.status).toBe(404);
    const res2 = await request(app.server).post('/slack/webhooks/unknown').send({});
    expect(res2.status).toBe(404);
  });
});

describe('app integration: invalid Jira config does not break Slack', () => {
  let app;

  beforeAll(async () => {
    const slackHubspot = createSlackHubSpotService({
      token: 'pat-slack',
      pipelineId: SLACK_PIPELINE_ID,
      stageNewId: SLACK_STAGE_NEW_ID,
      stageCompletedId: SLACK_STAGE_COMPLETED_ID,
    });
    const slack = createSlackService({
      client: {
        auth: { test: async () => ({ bot_id: 'B_OWN' }) },
        conversations: { history: async () => ({ messages: [], response_metadata: {} }) },
        chat: { postMessage: async () => ({}) },
        users: { info: async () => ({ user: { real_name: 'X' } }) },
      },
    });
    const slackWebhooks = buildSlackWebhooksRouter({
      appSecret: SLACK_SECRET,
      stageCompletedId: SLACK_STAGE_COMPLETED_ID,
      slack,
      hubspot: slackHubspot,
    });
    app = createApp({
      mongo: connection,
      slack: { webhooks: slackWebhooks },
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('still serves /slack/webhooks/hubspot (Jira is not registered)', async () => {
    const body = JSON.stringify([{
      objectId: 't1',
      subscriptionType: 'ticket.propertyChange',
      propertyName: 'hs_pipeline_stage',
      propertyValue: SLACK_STAGE_COMPLETED_ID,
    }]);
    const res = await request(app.server)
      .post('/slack/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(SLACK_SECRET, body))
      .send(body);
    expect(res.status).toBe(200);
  });

  it('returns 404 on /jira/webhooks/hubspot because Jira was never wired', async () => {
    const body = JSON.stringify([]);
    const res = await request(app.server)
      .post('/jira/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(JIRA_SECRET, body))
      .send(body);
    expect(res.status).toBe(404);
  });

  it('still serves /healthz', async () => {
    const res = await request(app.server).get('/healthz');
    expect(res.status).toBe(200);
  });
});

describe('app integration: invalid Slack config does not break Jira', () => {
  let app;

  beforeAll(async () => {
    const jiraHubspot = createHubSpotService({
      token: 'pat-jira',
      jiraBaseUrl: 'https://org.atlassian.net',
      pipelineId: PIPELINE_ID,
      newStageId: STAGE_NEW_ID,
      withRetry: (fn) => fn(),
    });
    const jira = createJiraService({
      baseUrl: 'https://org.atlassian.net',
      email: 'svc@example.com',
      apiToken: 'token-abc',
      withRetry: (fn) => fn(),
    });
    const jiraWebhooks = buildJiraWebhooksRouter({
      appSecret: JIRA_SECRET,
      closedStageId: STAGE_CLOSED_ID,
      jira,
      hubspot: jiraHubspot,
      transitionDoneId: '31',
    });
    app = createApp({
      mongo: connection,
      jira: { webhooks: jiraWebhooks },
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('still serves /jira/webhooks/hubspot (Slack is not registered)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' } }),
      text: async () => '{}',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' } }),
        text: async () => '{}',
        headers: { get: () => null },
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'comment-99' }),
        text: async () => '{"id":"comment-99"}',
        headers: { get: () => null },
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
        headers: { get: () => null },
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
        headers: { get: () => null },
      });
      const body = JSON.stringify([{ objectId: 't1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: STAGE_CLOSED_ID }]);
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(JIRA_SECRET, body))
        .send(body);
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns 404 on /slack/webhooks/hubspot', async () => {
    const res = await request(app.server).post('/slack/webhooks/hubspot').send({});
    expect(res.status).toBe(404);
  });

  it('still serves /healthz', async () => {
    const res = await request(app.server).get('/healthz');
    expect(res.status).toBe(200);
  });
});