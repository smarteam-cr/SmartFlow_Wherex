import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let mongod;
let connection;
let store;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  connection = require('../../src/db/connection');
  await connection.connect(mongod.getUri(), 'test_slack_store');
  await connection.getDb().collection('processed_messages').createIndex(
    { channel: 1, ts: 1 },
    { unique: true }
  );
  store = require('../../src/modules/slack/store');
});

afterAll(async () => {
  if (connection) await connection.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await store.__reset();
});

describe('modules/slack/store', () => {
  it('returns null watermark before any is set', async () => {
    expect(await store.getWatermark()).toBeNull();
  });

  it('sets and gets the watermark (string seconds.fractional)', async () => {
    await store.setWatermark('1719950700.123456');
    expect(await store.getWatermark()).toBe('1719950700.123456');
  });

  it('uses the slack-specific watermark id slack_ingest (not jira_ingest)', async () => {
    await store.setWatermark('1719950700.000000');
    const doc = await connection.getDb().collection('watermark').findOne({ _id: 'slack_ingest' });
    expect(doc).not.toBeNull();
    expect(doc.ts).toBe('1719950700.000000');
  });

  it('reports a ts as not processed until marked', async () => {
    expect(await store.isProcessed('C0TEST', '111.111')).toBe(false);
    await store.markProcessed('C0TEST', '111.111', 'ticket-1');
    expect(await store.isProcessed('C0TEST', '111.111')).toBe(true);
  });

  it('enforces uniqueness on (channel, ts)', async () => {
    await store.markProcessed('C0TEST', '222.222', 'ticket-2');
    await expect(store.markProcessed('C0TEST', '222.222', 'ticket-3')).rejects.toThrow();
  });

  it('allows the same ts across different channels', async () => {
    await store.markProcessed('C-A', '300.000', 'ticket-a');
    await store.markProcessed('C-B', '300.000', 'ticket-b');
    expect(await store.isProcessed('C-A', '300.000')).toBe(true);
    expect(await store.isProcessed('C-B', '300.000')).toBe(true);
  });

  it('does not consider a ts processed for a different channel', async () => {
    await store.markProcessed('C0TEST', '400.000', 'ticket-1');
    expect(await store.isProcessed('OTHER', '400.000')).toBe(false);
  });

  it('__reset() clears both watermark and processed_messages', async () => {
    await store.setWatermark('1719950700.000000');
    await store.markProcessed('C0TEST', '500.000', 'ticket-1');
    await store.__reset();
    expect(await store.getWatermark()).toBeNull();
    expect(await store.isProcessed('C0TEST', '500.000')).toBe(false);
  });

  it('store methods throw when the shared connection is not connected', async () => {
    await connection.close();
    try {
      await expect(store.getWatermark()).rejects.toThrow(/not connected/i);
      await expect(store.setWatermark('x')).rejects.toThrow(/not connected/i);
      await expect(store.isProcessed('C0TEST', 'x')).rejects.toThrow(/not connected/i);
      await expect(store.markProcessed('C0TEST', 'x', 't')).rejects.toThrow(/not connected/i);
    } finally {
      await connection.connect(mongod.getUri(), 'test_slack_store');
      await connection.getDb().collection('processed_messages').createIndex(
        { channel: 1, ts: 1 },
        { unique: true }
      );
    }
  });
});