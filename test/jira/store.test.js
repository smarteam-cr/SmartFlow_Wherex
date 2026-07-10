import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let mongod;
let connection;
let store;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  connection = require('../../src/db/connection');
  await connection.connect(mongod.getUri(), 'test_jira_store');
  await connection.getDb().collection('processed_issues').createIndex(
    { project: 1, issueKey: 1 },
    { unique: true }
  );
  store = require('../../src/modules/jira/store');
});

afterAll(async () => {
  if (connection) await connection.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await store.__reset();
});

describe('modules/jira/store', () => {
  it('returns null watermark before any is set', async () => {
    expect(await store.getWatermark()).toBeNull();
  });

  it('sets and gets the watermark', async () => {
    await store.setWatermark('2026-07-08T10:00:00.000Z');
    expect(await store.getWatermark()).toBe('2026-07-08T10:00:00.000Z');
  });

  it('overwrites the watermark on a second set', async () => {
    await store.setWatermark('2026-07-08T10:00:00.000Z');
    await store.setWatermark('2026-07-08T10:05:00.000Z');
    expect(await store.getWatermark()).toBe('2026-07-08T10:05:00.000Z');
  });

  it('uses the jira-specific watermark id jira_ingest (not slack_ingest)', async () => {
    await store.setWatermark('2026-07-08T10:00:00.000Z');
    const doc = await connection.getDb().collection('watermark').findOne({ _id: 'jira_ingest' });
    expect(doc).not.toBeNull();
    expect(doc.ts).toBe('2026-07-08T10:00:00.000Z');
  });

  it('reports an issue as not processed until marked', async () => {
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(false);
    await store.markProcessed('PROJ', 'PROJ-1', 'task-1');
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(true);
  });

  it('enforces uniqueness on (project, issueKey)', async () => {
    await store.markProcessed('PROJ', 'PROJ-1', 'task-1');
    await expect(store.markProcessed('PROJ', 'PROJ-1', 'task-2')).rejects.toThrow();
  });

  it('allows the same issueKey across different projects', async () => {
    await store.markProcessed('PROJ', 'PROJ-1', 'task-1');
    await store.markProcessed('AUX', 'PROJ-1', 'task-2');
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(await store.isProcessed('AUX', 'PROJ-1')).toBe(true);
  });

  it('does not consider an issue processed for a different project', async () => {
    await store.markProcessed('PROJ', 'PROJ-1');
    expect(await store.isProcessed('AUX', 'PROJ-1')).toBe(false);
  });

  it('__reset() clears both watermark and processed_issues', async () => {
    await store.setWatermark('2026-07-08T10:00:00.000Z');
    await store.markProcessed('PROJ', 'PROJ-1', 'task-1');
    await store.__reset();
    expect(await store.getWatermark()).toBeNull();
    expect(await store.isProcessed('PROJ', 'PROJ-1')).toBe(false);
  });

  it('store methods throw when the shared connection is not connected', async () => {
    await connection.close();
    try {
      await expect(store.getWatermark()).rejects.toThrow(/not connected/i);
      await expect(store.setWatermark('x')).rejects.toThrow(/not connected/i);
      await expect(store.isProcessed('PROJ', 'PROJ-1')).rejects.toThrow(/not connected/i);
      await expect(store.markProcessed('PROJ', 'PROJ-1', 'task')).rejects.toThrow(/not connected/i);
    } finally {
      await connection.connect(mongod.getUri(), 'test_jira_store');
      await connection.getDb().collection('processed_issues').createIndex(
        { project: 1, issueKey: 1 },
        { unique: true }
      );
    }
  });
});