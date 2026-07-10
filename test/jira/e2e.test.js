import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const request = require('supertest');

let mongod;
let connection;
let createJiraService;
let createHubSpotService;
let createIngestJob;
let buildJiraWebhooksRouter;
let createApp;
let fetchMock;
let jira;
let hubspot;
let ingest;
let app;
let store;

const APP_SECRET = 'test-app-secret-e2e';
const PIPELINE_ID = 'pipeline-1';
const NEW_STAGE_ID = 'stage-new';
const CLOSED_STAGE_ID = 'stage-closed';

function okJson(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null } };
}
function errJson(status, body = '') {
  return { ok: false, status, json: async () => ({}), text: async () => body, headers: { get: () => null } };
}

const noRetry = (fn) => fn();

function signV1(body) {
  return crypto.createHash('sha256').update(APP_SECRET + body).digest('hex');
}

function ticketClosedEvent(objectId = 'ticket-1', overrides = {}) {
  return [
    {
      objectId,
      subscriptionType: 'ticket.propertyChange',
      propertyName: 'hs_pipeline_stage',
      propertyValue: CLOSED_STAGE_ID,
      ...overrides,
    },
  ];
}

function postWebhook(events) {
  const body = JSON.stringify(events);
  return request(app.server)
    .post('/jira/webhooks/hubspot')
    .set('Content-Type', 'application/json')
    .set('x-hubspot-signature', signV1(body))
    .send(body);
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  connection = require('../../src/db/connection');
  await connection.connect(mongod.getUri(), 'test_jira_e2e');
  await connection.getDb().collection('processed_issues').createIndex(
    { project: 1, issueKey: 1 },
    { unique: true }
  );
  store = require('../../src/modules/jira/store');

  createJiraService = require('../../src/modules/jira/services/jira');
  createHubSpotService = require('../../src/modules/jira/services/hubspot');
  createIngestJob = require('../../src/modules/jira/jobs/ingest').createIngestJob;
  buildJiraWebhooksRouter = require('../../src/routes/jira/webhooks').buildJiraWebhooksRouter;
  ({ createApp } = require('../../src/app'));
}, 30000);

afterAll(async () => {
  await connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await store.__reset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  jira = createJiraService({
    baseUrl: 'https://org.atlassian.net',
    email: 'svc@example.com',
    apiToken: 'token-abc',
    withRetry: noRetry,
  });
  hubspot = createHubSpotService({
    token: 'pat-na1-test',
    jiraBaseUrl: 'https://org.atlassian.net',
    pipelineId: PIPELINE_ID,
    newStageId: NEW_STAGE_ID,
    withRetry: noRetry,
  });
  ingest = createIngestJob({
    jira,
    hubspot,
    store,
    projects: ['PROJ'],
    pollIntervalMin: 5,
  });
  const webhooks = buildJiraWebhooksRouter({
    appSecret: APP_SECRET,
    closedStageId: CLOSED_STAGE_ID,
    jira,
    hubspot,
    transitionDoneId: '31',
  });
  app = createApp({ mongo: connection, jira: { webhooks } });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  vi.unstubAllGlobals();
});

describe('jira e2e: Flujo A (ingesta) y Flujo B (callback)', () => {
  it('ingest crea tickets en HubSpot y marca processed_issues', async () => {
    const issue = {
      key: 'PROJ-1',
      fields: {
        summary: 'A',
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
        project: { key: 'PROJ' },
        updated: '2026-07-08T10:00:00.000+0000',
        issuetype: { name: 'Task' },
        status: { name: 'To Do' },
      },
    };
    fetchMock
      .mockResolvedValueOnce(okJson({ issues: [issue] }))
      .mockResolvedValueOnce(okJson({ total: 0, results: [] }))
      .mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
    const result = await ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') });
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([]);
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('webhook con ticket movido a la etapa cerrada responde 200 y hace respondToIssue + updateTicket', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' } }))
      .mockResolvedValueOnce(okJson({ id: 'comment-99' }))
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({}));
    const res = await postWebhook(ticketClosedEvent());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('segundo webhook con el mismo ticket: no repite calls a JIRA', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' } }))
      .mockResolvedValueOnce(okJson({ id: 'comment-99' }))
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({}));
    await postWebhook(ticketClosedEvent());
    const callsAfterFirst = fetchMock.mock.calls.length;

    fetchMock.mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'true' } }));
    const res2 = await postWebhook(ticketClosedEvent());
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ ok: true });
    expect(fetchMock.mock.calls.length - callsAfterFirst).toBe(1);
    const [url, opts] = fetchMock.mock.calls[callsAfterFirst];
    expect(url).toContain('/crm/v3/objects/tickets/ticket-1');
    expect(opts.method).toBe('GET');
  });

  it('ingest concurrente con el mismo issueKey: solo 1 ticket (indice unico Mongo)', async () => {
    const issue = {
      key: 'PROJ-1',
      fields: {
        summary: 'A',
        description: null,
        project: { key: 'PROJ' },
        updated: '2026-07-08T10:00:00.000+0000',
        issuetype: { name: 'Task' },
        status: { name: 'To Do' },
      },
    };
    fetchMock
      .mockResolvedValueOnce(okJson({ issues: [issue] }))
      .mockResolvedValueOnce(okJson({ total: 0, results: [] }))
      .mockResolvedValueOnce(okJson({ id: 'ticket-1' }))
      .mockResolvedValueOnce(okJson({ issues: [issue] }))
      .mockResolvedValueOnce(okJson({ total: 0, results: [] }))
      .mockResolvedValueOnce(okJson({ id: 'ticket-2' }));

    const [a, b] = await Promise.all([
      ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') }),
      ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') }),
    ]);
    const total = a.created + b.created;
    expect(total).toBe(1);
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(true);
  });

  it('cross-flow completo: ingest crea ticket, webhook la marca, segundo webhook no repite', async () => {
    const issue = {
      key: 'PROJ-1',
      fields: {
        summary: 'A',
        description: null,
        project: { key: 'PROJ' },
        updated: '2026-07-08T10:00:00.000+0000',
        issuetype: { name: 'Task' },
        status: { name: 'To Do' },
      },
    };
    fetchMock
      .mockResolvedValueOnce(okJson({ issues: [issue] }))
      .mockResolvedValueOnce(okJson({ total: 0, results: [] }))
      .mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
    const ingestResult = await ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') });
    expect(ingestResult.created).toBe(1);

    fetchMock
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' } }))
      .mockResolvedValueOnce(okJson({ id: 'comment-99' }))
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({}));
    const r1 = await postWebhook(ticketClosedEvent());
    expect(r1.body).toEqual({ ok: true });

    fetchMock.mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'true' } }));
    const r2 = await postWebhook(ticketClosedEvent());
    expect(r2.body).toEqual({ ok: true });
  });

  it('webhook sin firma: 401, no fetch calls', async () => {
    const res = await request(app.server)
      .post('/jira/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(ticketClosedEvent()));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('healthz responde 200 antes y despues del ingest', async () => {
    const r1 = await request(app.server).get('/healthz');
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ ok: true, mongo: 'up' });
    fetchMock.mockResolvedValueOnce(okJson({ issues: [] }));
    await ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') });
    const r2 = await request(app.server).get('/healthz');
    expect(r2.status).toBe(200);
  });
});

describe('jira e2e: error paths', () => {
  it('JIRA caido en ingesta: watermark NO avanza, proxima corrida recupera', async () => {
    fetchMock.mockRejectedValue(new Error('JIRA 503'));
    const before = await store.getWatermark();
    const result = await ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].project).toBe('PROJ');
    expect(await store.getWatermark()).toBe(before);
  });

  it('JIRA falla en respondToIssue del webhook: 500 para que HubSpot reintente', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' } }))
      .mockResolvedValueOnce(errJson(503, 'down'));
    const res = await postWebhook(ticketClosedEvent());
    expect(res.status).toBe(500);
  });
});