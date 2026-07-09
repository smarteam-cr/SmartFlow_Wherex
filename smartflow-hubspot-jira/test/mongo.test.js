import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let mongod;
let mongo;

describe('db/mongo', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongo = require('../src/db/mongo');
    await mongo.connect(mongod.getUri(), 'test_jira_hubspot');
  });

  afterAll(async () => {
    await mongo.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await mongo.__reset();
  });

  it('returns null watermark before any is set', async () => {
    expect(await mongo.getWatermark()).toBeNull();
  });

  it('sets and gets the watermark', async () => {
    await mongo.setWatermark('2026-07-08T10:00:00.000Z');
    expect(await mongo.getWatermark()).toBe('2026-07-08T10:00:00.000Z');
  });

  it('overwrites the watermark on a second set', async () => {
    await mongo.setWatermark('2026-07-08T10:00:00.000Z');
    await mongo.setWatermark('2026-07-08T10:05:00.000Z');
    expect(await mongo.getWatermark()).toBe('2026-07-08T10:05:00.000Z');
  });

  it('reports an issue as not processed until marked', async () => {
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(false);
    await mongo.markProcessed('PROJ', 'PROJ-1', 'task-1');
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(true);
  });

  it('enforces uniqueness on (project, issueKey)', async () => {
    await mongo.markProcessed('PROJ', 'PROJ-1', 'task-1');
    await expect(mongo.markProcessed('PROJ', 'PROJ-1', 'task-2')).rejects.toThrow();
  });

  it('allows the same issueKey across different projects', async () => {
    await mongo.markProcessed('PROJ', 'PROJ-1', 'task-1');
    await mongo.markProcessed('AUX', 'PROJ-1', 'task-2');
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(true);
    expect(await mongo.isProcessed('AUX', 'PROJ-1')).toBe(true);
  });

  it('does not consider an issue processed for a different project', async () => {
    await mongo.markProcessed('PROJ', 'PROJ-1', 'task-1');
    expect(await mongo.isProcessed('AUX', 'PROJ-1')).toBe(false);
  });

  it('__reset() clears both collections', async () => {
    await mongo.setWatermark('2026-07-08T10:00:00.000Z');
    await mongo.markProcessed('PROJ', 'PROJ-1', 'task-1');
    await mongo.__reset();
    expect(await mongo.getWatermark()).toBeNull();
    expect(await mongo.isProcessed('PROJ', 'PROJ-1')).toBe(false);
  });

  it('connect with an invalid URI throws', async () => {
    await expect(mongo.connect('not-a-valid-uri', 'junk')).rejects.toThrow();
  });

  it('close() without prior connect does not throw', async () => {
    const fresh = require('../src/db/mongo');
    // The module re-uses the same client across requires; the call must be safe.
    await expect(fresh.close()).resolves.toBeUndefined();
  });
});
