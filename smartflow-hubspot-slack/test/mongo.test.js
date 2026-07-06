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
    await mongo.connect(mongod.getUri(), 'test_slack_hubspot');
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
    await mongo.setWatermark('1719950700.123456');
    expect(await mongo.getWatermark()).toBe('1719950700.123456');
  });

  it('reports a ts as not processed until marked', async () => {
    expect(await mongo.isProcessed('C0TEST', '111.111')).toBe(false);
    await mongo.markProcessed('C0TEST', '111.111', 'ticket-1');
    expect(await mongo.isProcessed('C0TEST', '111.111')).toBe(true);
  });

  it('enforces uniqueness on (channel, ts)', async () => {
    await mongo.markProcessed('C0TEST', '222.222', 'ticket-2');
    await expect(mongo.markProcessed('C0TEST', '222.222', 'ticket-3')).rejects.toThrow();
  });
});
