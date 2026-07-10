import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let mongod;
let connection;
let createIngestJob;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  connection = require('../../src/db/connection');
  await connection.connect(mongod.getUri(), 'test_jira_ingest');
  await connection.getDb().collection('processed_issues').createIndex(
    { project: 1, issueKey: 1 },
    { unique: true }
  );
  delete require.cache[require.resolve('../../src/modules/jira/jobs/ingest')];
  createIngestJob = require('../../src/modules/jira/jobs/ingest').createIngestJob;
});

afterAll(async () => {
  await connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  const store = require('../../src/modules/jira/store');
  await store.__reset();
});

function fakeJira(issuesByJql = {}) {
  return {
    searchIssues: vi.fn(async ({ jql }) => issuesByJql[jql] || []),
    getIssue: vi.fn(async (key) => ({ key, fields: {}, names: {} })),
  };
}
function fakeHubspot({ existingKeys = new Set(), created = [] } = {}) {
  return {
    findTicketByJiraKey: vi.fn(async (key) => (existingKeys.has(key) ? { id: `existing-${key}` } : null)),
    createTicket: vi.fn(async (issue) => {
      const id = `ticket-${issue.key}`;
      created.push(issue.key);
      return { id };
    }),
    attachNote: vi.fn(async () => {}),
  };
}

function issue({ key, project = 'PROJ', updated = '2026-07-08T10:00:00.000+0000', summary = 's', issuetype, status, subtaskType = false }) {
  return {
    key,
    fields: {
      summary,
      project: { key: project },
      updated,
      issuetype: issuetype || { name: subtaskType ? 'Sub-task' : 'Task' },
      status: status || { name: 'To Do' },
    },
  };
}

describe('modules/jira/jobs/ingest', () => {
  const NOW = new Date('2026-07-08T10:05:00.000Z');
  let store;

  beforeAll(() => {
    store = require('../../src/modules/jira/store');
  });

  it('first run uses now - pollIntervalMin as the JQL lower bound', async () => {
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    const jql = jira.searchIssues.mock.calls[0][0].jql;
    expect(jql).toContain('project = PROJ');
    expect(jql).toContain('updated >= "-5m"');
    expect(jql).toContain('ORDER BY updated ASC');
  });

  it('subsequent runs use the persisted watermark as lower bound', async () => {
    await store.setWatermark('2026-07-08T09:30:00.000Z');
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    const jql = jira.searchIssues.mock.calls[0][0].jql;
    expect(jql).toContain('updated >= "-35m"');
  });

  it('queries each project and aggregates results', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
      ],
      'project = AUX AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'AUX-1', project: 'AUX' }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ', 'AUX'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(2);
    expect(jira.searchIssues).toHaveBeenCalledTimes(2);
  });

  it('skips issues that already have a HubSpot task', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2' }),
      ],
    });
    const hubspot = fakeHubspot({ existingKeys: new Set(['PROJ-1']) });
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(hubspot.createTicket).toHaveBeenCalledTimes(1);
  });

  it('records each created issue in store with project, issueKey, taskId', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2' }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(await store.isProcessed('PROJ', 'PROJ-2')).toBe(true);
  });

  it('does not create a duplicate ticket when the same issue reappears in a later poll before HubSpot search catches up', async () => {
    // hubspot.findTicketByJiraKey's search index can lag behind a just-created
    // ticket, so it alone is not a safe dedup check across separate poll runs.
    const jira = {
      searchIssues: vi.fn(async () => [issue({ key: 'PROJ-1' })]),
      getIssue: vi.fn(async (key) => ({ key, fields: {}, names: {} })),
    };
    const hubspot = fakeHubspot(); // findTicketByJiraKey always returns null
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });

    const firstResult = await ingest.run({ now: NOW });
    const secondResult = await ingest.run({ now: new Date(NOW.getTime() + 5 * 60 * 1000) });

    expect(hubspot.createTicket).toHaveBeenCalledTimes(1);
    expect(firstResult.created).toBe(1);
    expect(secondResult.created).toBe(0);
    expect(secondResult.skipped).toBe(1);
  });

  it('attaches a HubSpot note with the full Jira issue details after creating a ticket', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [issue({ key: 'PROJ-1' })],
    });
    jira.getIssue = vi.fn(async (key) => ({
      key,
      fields: { summary: 's', customfield_10088: 'Acme Corp' },
      names: { customfield_10088: 'Empresa solicitante' },
    }));
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    expect(jira.getIssue).toHaveBeenCalledWith('PROJ-1');
    expect(hubspot.attachNote).toHaveBeenCalledWith(
      'ticket-PROJ-1',
      expect.stringContaining('Empresa solicitante: Acme Corp')
    );
  });

  it('skips attachNote when the issue has no displayable extra fields', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [issue({ key: 'PROJ-1' })],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    expect(hubspot.attachNote).not.toHaveBeenCalled();
  });

  it('does not fail ticket creation when attaching the note fails', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [issue({ key: 'PROJ-1' })],
    });
    jira.getIssue = vi.fn(async (key) => ({
      key,
      fields: { customfield_1: 'value' },
      names: {},
    }));
    const hubspot = fakeHubspot();
    hubspot.attachNote = vi.fn().mockRejectedValue(new Error('HubSpot 500'));
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('advances the watermark to the max updated timestamp', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1', updated: '2026-07-08T10:01:00.000+0000' }),
        issue({ key: 'PROJ-2', updated: '2026-07-08T10:03:30.000+0000' }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.watermark).toBe('2026-07-08T10:03:30.000Z');
    expect(await store.getWatermark()).toBe('2026-07-08T10:03:30.000Z');
  });

  it('sets watermark to now when there are no issues', async () => {
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.watermark).toBe('2026-07-08T10:05:00.000Z');
    expect(await store.getWatermark()).toBe('2026-07-08T10:05:00.000Z');
  });

  it('does NOT advance the watermark when JIRA throws', async () => {
    const jira = { searchIssues: vi.fn().mockRejectedValue(new Error('JIRA 503')) };
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({ project: 'PROJ' });
    expect(await store.getWatermark()).toBeNull();
  });

  it('continues processing when one issue fails (e.g. HubSpot 400)', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2' }),
        issue({ key: 'PROJ-3' }),
      ],
    });
    const hubspot = {
      findTicketByJiraKey: vi.fn(async () => null),
      createTicket: vi.fn(async (iss) => {
        if (iss.key === 'PROJ-2') throw new Error('HubSpot 400');
        return { id: `ticket-${iss.key}` };
      }),
    };
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatchObject({ issueKey: 'PROJ-2' });
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(await store.isProcessed('PROJ', 'PROJ-2')).toBe(false);
    expect(await store.isProcessed('PROJ', 'PROJ-3')).toBe(true);
  });

  it('skips subtasks when skipSubtasks=true', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2', subtaskType: true }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5, skipSubtasks: true });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('includes subtasks by default (skipSubtasks=false)', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1', subtaskType: true }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
  });

  it('skips issues in terminal statuses (excludeStatuses)', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "-5m" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2', status: { name: 'Done' } }),
        issue({ key: 'PROJ-3', status: { name: 'Cancelled' } }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({
      jira,
      hubspot,
      store,
      projects: ['PROJ'],
      pollIntervalMin: 5,
      excludeStatuses: ['Done', 'Closed', 'Cancelled'],
    });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('returns shape { created, skipped, errors, watermark }', async () => {
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result).toHaveProperty('created');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('watermark');
  });

  it('throws when projects is missing or empty', () => {
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    expect(() => createIngestJob({ jira, hubspot, store, pollIntervalMin: 5 })).toThrow();
    expect(() => createIngestJob({ jira, hubspot, store, projects: [], pollIntervalMin: 5 })).toThrow();
  });

  it('throws when pollIntervalMin is invalid', () => {
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    expect(() => createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: 0 })).toThrow();
    expect(() => createIngestJob({ jira, hubspot, store, projects: ['PROJ'], pollIntervalMin: -1 })).toThrow();
  });

  it('throws when required dependencies are missing', () => {
    const hubspot = fakeHubspot();
    expect(() => createIngestJob({ hubspot, store, projects: ['PROJ'], pollIntervalMin: 5 })).toThrow(/jira/);
    const jira = fakeJira();
    expect(() => createIngestJob({ jira, store, projects: ['PROJ'], pollIntervalMin: 5 })).toThrow(/hubspot/);
    expect(() => createIngestJob({ jira, hubspot, projects: ['PROJ'], pollIntervalMin: 5 })).toThrow(/store/);
  });
});