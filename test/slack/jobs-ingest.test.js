import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let mongod;
let connection;
let store;
let createIngestJob;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  connection = require('../../src/db/connection');
  await connection.connect(mongod.getUri(), 'test_slack_ingest');
  await connection.getDb().collection('processed_messages').createIndex(
    { channel: 1, ts: 1 },
    { unique: true }
  );
  store = require('../../src/modules/slack/store');
  delete require.cache[require.resolve('../../src/modules/slack/jobs/ingest')];
  ({ createIngestJob } = require('../../src/modules/slack/jobs/ingest'));
});

afterAll(async () => {
  await connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  await store.__reset();
});

let deps;

beforeEach(() => {
  deps = {
    channel: 'C0TEST',
    pollIntervalMin: 5,
    store: {
      getWatermark: vi.fn().mockResolvedValue('100.0'),
      setWatermark: vi.fn().mockResolvedValue(),
      isProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(),
    },
    slack: {
      getMessages: vi.fn().mockResolvedValue([]),
    },
    hubspot: {
      findTicketBySlackTs: vi.fn().mockResolvedValue(null),
      createTicket: vi.fn().mockResolvedValue({ id: 'ticket-1' }),
    },
  };
});

describe('modules/slack/jobs/ingest', () => {
  it('returns {run}, not a bare function (normalized contract)', () => {
    const ingest = createIngestJob(deps);
    expect(typeof ingest).toBe('object');
    expect(typeof ingest.run).toBe('function');
  });

  it('creates a ticket for each new, non-duplicate message and advances the watermark', async () => {
    deps.slack.getMessages.mockResolvedValue([
      { ts: '101.0', text: 'hola' },
      { ts: '102.0', text: 'mundo' },
    ]);

    const ingest = createIngestJob(deps);
    await ingest.run();

    expect(deps.hubspot.createTicket).toHaveBeenCalledTimes(2);
    expect(deps.store.markProcessed).toHaveBeenCalledWith('C0TEST', '101.0', 'ticket-1');
    expect(deps.store.markProcessed).toHaveBeenCalledWith('C0TEST', '102.0', 'ticket-1');
    expect(deps.store.setWatermark).toHaveBeenCalledWith('102.0');
  });

  it('skips creating a ticket when already marked processed in store', async () => {
    deps.slack.getMessages.mockResolvedValue([{ ts: '101.0', text: 'hola' }]);
    deps.store.isProcessed.mockResolvedValue(true);

    const ingest = createIngestJob(deps);
    await ingest.run();

    expect(deps.hubspot.createTicket).not.toHaveBeenCalled();
  });

  it('skips creating a ticket when HubSpot Search already has it, and marks it processed locally', async () => {
    deps.slack.getMessages.mockResolvedValue([{ ts: '101.0', text: 'hola' }]);
    deps.hubspot.findTicketBySlackTs.mockResolvedValue({ id: 'existing-ticket' });

    const ingest = createIngestJob(deps);
    await ingest.run();

    expect(deps.hubspot.createTicket).not.toHaveBeenCalled();
    expect(deps.store.markProcessed).toHaveBeenCalledWith('C0TEST', '101.0', 'existing-ticket');
  });

  it('does not advance the watermark when there are no new messages', async () => {
    deps.slack.getMessages.mockResolvedValue([]);

    const ingest = createIngestJob(deps);
    await ingest.run();

    expect(deps.store.setWatermark).not.toHaveBeenCalled();
  });

  it('uses "now - pollIntervalMin" as oldest on first run when watermark is null', async () => {
    deps.store.getWatermark.mockResolvedValue(null);
    const before = Date.now() / 1000 - deps.pollIntervalMin * 60;
    const ingest = createIngestJob(deps);
    await ingest.run();
    const [, oldest, latest] = deps.slack.getMessages.mock.calls[0];
    expect(Number(oldest)).toBeCloseTo(before, 1);
    expect(Number(oldest)).toBeLessThan(Number(latest));
  });

  it('returns a result shape {created, skipped, errors, watermark} for parity with jira', async () => {
    deps.slack.getMessages.mockResolvedValue([{ ts: '101.0', text: 'x' }]);
    const ingest = createIngestJob(deps);
    const result = await ingest.run();
    expect(result).toHaveProperty('created');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('watermark');
  });

  it('throws when required dependencies are missing', () => {
    expect(() => createIngestJob({ slack: deps.slack, hubspot: deps.hubspot, store: deps.store, pollIntervalMin: 5 })).toThrow(/channel/);
    expect(() => createIngestJob({ channel: deps.channel, hubspot: deps.hubspot, store: deps.store, pollIntervalMin: 5 })).toThrow(/slack/);
    expect(() => createIngestJob({ channel: deps.channel, slack: deps.slack, store: deps.store, pollIntervalMin: 5 })).toThrow(/hubspot/);
    expect(() => createIngestJob({ channel: deps.channel, slack: deps.slack, hubspot: deps.hubspot, pollIntervalMin: 5 })).toThrow(/store/);
    expect(() => createIngestJob({ channel: deps.channel, slack: deps.slack, hubspot: deps.hubspot, store: deps.store, pollIntervalMin: 0 })).toThrow(/pollIntervalMin/);
  });
});