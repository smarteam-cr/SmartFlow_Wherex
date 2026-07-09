import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const request = require('supertest');

let mongod;
let mongo;
let createJiraService;
let createHubSpotService;
let createIngestJob;
let createApp;
let fetchMock;
let jira;
let hubspot;
let ingest;
let app;

const SECRET = 'whsec-e2e-secret';
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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.JIRA_BASE_URL = 'https://org.atlassian.net';
  process.env.JIRA_EMAIL = 'svc@example.com';
  process.env.JIRA_API_TOKEN = 'token-abc';
  process.env.JIRA_PROJECT_KEY = 'PROJ';
  process.env.HUBSPOT_TOKEN = 'pat-na1-test';
  process.env.WEBHOOK_SECRET = SECRET;
  process.env.MONGO_URI = 'mongodb://localhost:27017/test_e2e';
  process.env.HUBSPOT_TICKET_PIPELINE_ID = PIPELINE_ID;
  process.env.HUBSPOT_TICKET_STAGE_NEW_ID = NEW_STAGE_ID;
  process.env.HUBSPOT_TICKET_STAGE_CLOSED_ID = CLOSED_STAGE_ID;

  mongo = require('../src/db/mongo');
  await mongo.connect(mongod.getUri(), 'test_e2e');

  createJiraService = require('../src/services/jira');
  createHubSpotService = require('../src/services/hubspot');
  createIngestJob = require('../src/jobs/ingestJira');
  createApp = require('../src/server').createApp;
});

afterAll(async () => {
  await mongo.close();
  await mongod.stop();
});

beforeEach(async () => {
  await mongo.__reset();
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
    mongo,
    projects: ['PROJ'],
    pollIntervalMin: 5,
  });
  app = createApp({
    mongo,
    jira,
    hubspot,
    transitionDoneId: '31',
    closedStageId: CLOSED_STAGE_ID,
  });
});

describe('e2e: Flujo A (ingesta) y Flujo B (callback)', () => {
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
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('webhook con ticket en la etapa cerrada responde 200 ok y hace respondToIssue + updateTicket', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false', hs_pipeline_stage: CLOSED_STAGE_ID } }))
      .mockResolvedValueOnce(okJson({ id: 'comment-99' }))
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
    const res = await request(app)
      .post('/webhooks/hubspot')
      .set('x-webhook-token', SECRET)
      .send({ objectId: 'ticket-1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('segundo webhook con el mismo ticket: skipped duplicate sin calls extra a JIRA', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false', hs_pipeline_stage: CLOSED_STAGE_ID } }))
      .mockResolvedValueOnce(okJson({ id: 'comment-99' }))
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
    await request(app).post('/webhooks/hubspot').set('x-webhook-token', SECRET).send({ objectId: 'ticket-1' });
    const callsAfterFirst = fetchMock.mock.calls.length;

    // 2nd webhook: only getTicket call (returns jira_listo_sent=true)
    fetchMock.mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'true', hs_pipeline_stage: CLOSED_STAGE_ID } }));
    const res2 = await request(app).post('/webhooks/hubspot').set('x-webhook-token', SECRET).send({ objectId: 'ticket-1' });
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ ok: true, skipped: 'duplicate' });
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
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(true);
  });

  it('cross-flow completo: ingest crea ticket, webhook la marca, segundo webhook skip', async () => {
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
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false', hs_pipeline_stage: CLOSED_STAGE_ID } }))
      .mockResolvedValueOnce(okJson({ id: 'comment-99' }))
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
    const r1 = await request(app).post('/webhooks/hubspot').set('x-webhook-token', SECRET).send({ objectId: 'ticket-1' });
    expect(r1.body.ok).toBe(true);
    expect(r1.body.commentId).toBeDefined();

    fetchMock.mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'true', hs_pipeline_stage: CLOSED_STAGE_ID } }));
    const r2 = await request(app).post('/webhooks/hubspot').set('x-webhook-token', SECRET).send({ objectId: 'ticket-1' });
    expect(r2.body).toEqual({ ok: true, skipped: 'duplicate' });
  });

  it('webhook sin token: 401, no fetch calls', async () => {
    const res = await request(app).post('/webhooks/hubspot').send({ objectId: 'ticket-1' });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('healthz responde 200 antes y despues del ingest', async () => {
    const r1 = await request(app).get('/healthz');
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ ok: true, mongo: 'up' });
    fetchMock.mockResolvedValueOnce(okJson({ issues: [] }));
    await ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') });
    const r2 = await request(app).get('/healthz');
    expect(r2.status).toBe(200);
  });
});

describe('e2e: error paths', () => {
  it('JIRA caido en ingesta: watermark NO avanza, proxima corrida recupera', async () => {
    fetchMock.mockRejectedValue(new Error('JIRA 503'));
    const before = await mongo.getWatermark();
    const result = await ingest.run({ now: new Date('2026-07-08T10:05:00.000Z') });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].project).toBe('PROJ');
    expect(await mongo.getWatermark()).toBe(before);
  });

  it('JIRA falla en respondToIssue del webhook: 500 para que HubSpot reintente', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'false', hs_pipeline_stage: CLOSED_STAGE_ID } }))
      .mockResolvedValueOnce(errJson(503, 'down'));
    const res = await request(app).post('/webhooks/hubspot').set('x-webhook-token', SECRET).send({ objectId: 'ticket-1' });
    expect(res.status).toBe(500);
  });
});
