import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let mongod;
let mongo;
let createIngestJob;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  mongo = require('../src/db/mongo');
  await mongo.connect(mongod.getUri(), 'test_ingest');
  delete require.cache[require.resolve('../src/jobs/ingestJira')];
  createIngestJob = require('../src/jobs/ingestJira');
});

afterAll(async () => {
  await mongo.close();
  await mongod.stop();
});

beforeEach(async () => {
  await mongo.__reset();
});

function fakeJira(issuesByJql = {}) {
  return {
    searchIssues: vi.fn(async ({ jql }) => issuesByJql[jql] || []),
  };
}
function fakeHubspot({ existingKeys = new Set(), created = [] } = {}) {
  return {
    findTaskByJiraKey: vi.fn(async (key) => (existingKeys.has(key) ? { id: `existing-${key}` } : null)),
    createTask: vi.fn(async (issue) => {
      const id = `task-${issue.key}`;
      created.push(issue.key);
      return { id };
    }),
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

describe('jobs/ingestJira', () => {
  const NOW = new Date('2026-07-08T10:05:00.000Z');

  it('first run uses now - pollIntervalMin as the JQL lower bound', async () => {
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    const jql = jira.searchIssues.mock.calls[0][0].jql;
    expect(jql).toContain('project = PROJ');
    expect(jql).toContain('updated >= "2026-07-08T10:00:00.000Z"');
    expect(jql).toContain('ORDER BY updated ASC');
  });

  it('subsequent runs use the persisted watermark as lower bound', async () => {
    await mongo.setWatermark('2026-07-08T09:30:00.000Z');
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    const jql = jira.searchIssues.mock.calls[0][0].jql;
    expect(jql).toContain('updated >= "2026-07-08T09:30:00.000Z"');
  });

  it('queries each project and aggregates results', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
      ],
      'project = AUX AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'AUX-1', project: 'AUX' }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ', 'AUX'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(2);
    expect(jira.searchIssues).toHaveBeenCalledTimes(2);
  });

  it('skips issues that already have a HubSpot task', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2' }),
      ],
    });
    const hubspot = fakeHubspot({ existingKeys: new Set(['PROJ-1']) });
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(hubspot.createTask).toHaveBeenCalledTimes(1);
  });

  it('records each created issue in mongo with project, issueKey, taskId', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2' }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    await ingest.run({ now: NOW });
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(await mongo.isProcessed('PROJ', 'PROJ-2')).toBe(true);
  });

  it('advances the watermark to the max updated timestamp', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1', updated: '2026-07-08T10:01:00.000+0000' }),
        issue({ key: 'PROJ-2', updated: '2026-07-08T10:03:30.000+0000' }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.watermark).toBe('2026-07-08T10:03:30.000Z');
    expect(await mongo.getWatermark()).toBe('2026-07-08T10:03:30.000Z');
  });

  it('sets watermark to now when there are no issues', async () => {
    const jira = fakeJira();
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.watermark).toBe('2026-07-08T10:05:00.000Z');
    expect(await mongo.getWatermark()).toBe('2026-07-08T10:05:00.000Z');
  });

  it('does NOT advance the watermark when JIRA throws', async () => {
    const jira = { searchIssues: vi.fn().mockRejectedValue(new Error('JIRA 503')) };
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({ project: 'PROJ' });
    expect(await mongo.getWatermark()).toBeNull();
  });

  it('continues processing when one issue fails (e.g. HubSpot 400)', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2' }),
        issue({ key: 'PROJ-3' }),
      ],
    });
    const hubspot = {
      findTaskByJiraKey: vi.fn(async () => null),
      createTask: vi.fn(async (iss) => {
        if (iss.key === 'PROJ-2') throw new Error('HubSpot 400');
        return { id: `task-${iss.key}` };
      }),
    };
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatchObject({ issueKey: 'PROJ-2' });
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(await mongo.isProcessed('PROJ', 'PROJ-2')).toBe(false);
    expect(await mongo.isProcessed('PROJ', 'PROJ-3')).toBe(true);
  });

  it('skips subtasks when skipSubtasks=true', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2', subtaskType: true }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5, skipSubtasks: true });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('includes subtasks by default (skipSubtasks=false)', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1', subtaskType: true }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result.created).toBe(1);
  });

  it('skips issues in terminal statuses (excludeStatuses)', async () => {
    const jira = fakeJira({
      'project = PROJ AND updated >= "2026-07-08T10:00:00.000Z" ORDER BY updated ASC': [
        issue({ key: 'PROJ-1' }),
        issue({ key: 'PROJ-2', status: { name: 'Done' } }),
        issue({ key: 'PROJ-3', status: { name: 'Cancelled' } }),
      ],
    });
    const hubspot = fakeHubspot();
    const ingest = createIngestJob({
      jira,
      hubspot,
      mongo,
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
    const ingest = createIngestJob({ jira, hubspot, mongo, projects: ['PROJ'], pollIntervalMin: 5 });
    const result = await ingest.run({ now: NOW });
    expect(result).toHaveProperty('created');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('watermark');
  });
});
