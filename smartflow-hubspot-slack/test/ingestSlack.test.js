import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { createIngestJob } = require('../src/jobs/ingestSlack');

let deps;

beforeEach(() => {
  deps = {
    channel: 'C0TEST',
    pollIntervalMin: 5,
    mongo: {
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

describe('jobs/ingestSlack', () => {
  it('creates a ticket for each new, non-duplicate message and advances the watermark', async () => {
    deps.slack.getMessages.mockResolvedValue([
      { ts: '101.0', text: 'hola' },
      { ts: '102.0', text: 'mundo' },
    ]);

    const ingest = createIngestJob(deps);
    await ingest();

    expect(deps.hubspot.createTicket).toHaveBeenCalledTimes(2);
    expect(deps.mongo.markProcessed).toHaveBeenCalledWith('C0TEST', '101.0', 'ticket-1');
    expect(deps.mongo.markProcessed).toHaveBeenCalledWith('C0TEST', '102.0', 'ticket-1');
    expect(deps.mongo.setWatermark).toHaveBeenCalledWith('102.0');
  });

  it('skips creating a ticket when already marked processed in Mongo', async () => {
    deps.slack.getMessages.mockResolvedValue([{ ts: '101.0', text: 'hola' }]);
    deps.mongo.isProcessed.mockResolvedValue(true);

    const ingest = createIngestJob(deps);
    await ingest();

    expect(deps.hubspot.createTicket).not.toHaveBeenCalled();
  });

  it('skips creating a ticket when HubSpot Search already has it, and marks it processed locally', async () => {
    deps.slack.getMessages.mockResolvedValue([{ ts: '101.0', text: 'hola' }]);
    deps.hubspot.findTicketBySlackTs.mockResolvedValue({ id: 'existing-ticket' });

    const ingest = createIngestJob(deps);
    await ingest();

    expect(deps.hubspot.createTicket).not.toHaveBeenCalled();
    expect(deps.mongo.markProcessed).toHaveBeenCalledWith('C0TEST', '101.0', 'existing-ticket');
  });

  it('does not advance the watermark when there are no new messages', async () => {
    deps.slack.getMessages.mockResolvedValue([]);

    const ingest = createIngestJob(deps);
    await ingest();

    expect(deps.mongo.setWatermark).not.toHaveBeenCalled();
  });

  it('uses "now - pollIntervalMin" as oldest on first run when watermark is null', async () => {
    deps.mongo.getWatermark.mockResolvedValue(null);
    const before = Date.now() / 1000 - deps.pollIntervalMin * 60;
    const ingest = createIngestJob(deps);
    await ingest();
    const [, oldest, latest] = deps.slack.getMessages.mock.calls[0];
    expect(Number(oldest)).toBeCloseTo(before, 1);
    expect(Number(oldest)).toBeLessThan(Number(latest));
  });
});
