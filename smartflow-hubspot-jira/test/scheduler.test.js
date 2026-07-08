import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let startScheduler;
let stopScheduler;
let scheduleMock;
let stopHandle;

beforeEach(() => {
  vi.resetModules();
  scheduleMock = vi.fn(() => {
    stopHandle = { stop: vi.fn() };
    return stopHandle;
  });
  vi.doMock('node-cron', () => ({
    schedule: scheduleMock,
  }));
  ({ startScheduler, stopScheduler } = require('../src/scheduler'));
});

afterEach(() => {
  vi.doUnmock('node-cron');
  vi.useRealTimers();
});

describe('scheduler', () => {
  it('schedules a job with the cron expression "*/N * * * *" for the given interval', () => {
    const ingest = { run: vi.fn() };
    startScheduler({ ingest, intervalMin: 5 });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const [expr, handler] = scheduleMock.mock.calls[0];
    expect(expr).toBe('*/5 * * * *');
    expect(typeof handler).toBe('function');
  });

  it('uses different cron expression for other intervals', () => {
    const ingest = { run: vi.fn() };
    startScheduler({ ingest, intervalMin: 10 });
    expect(scheduleMock.mock.calls[0][0]).toBe('*/10 * * * *');
  });

  it('runs the wrapped ingest and swallows errors (does not throw synchronously)', async () => {
    const ingest = { run: vi.fn().mockRejectedValue(new Error('boom')) };
    startScheduler({ ingest, intervalMin: 5 });
    const handler = scheduleMock.mock.calls[0][1];
    await expect(handler()).resolves.toBeUndefined();
    expect(ingest.run).toHaveBeenCalledTimes(1);
  });

  it('passes a Date "now" to ingest.run', async () => {
    const ingest = { run: vi.fn() };
    startScheduler({ ingest, intervalMin: 5 });
    const handler = scheduleMock.mock.calls[0][1];
    await handler();
    expect(ingest.run).toHaveBeenCalledTimes(1);
    const arg = ingest.run.mock.calls[0][0];
    expect(arg).toHaveProperty('now');
    expect(arg.now).toBeInstanceOf(Date);
  });

  it('stopScheduler calls .stop() on the active handle', () => {
    const ingest = { run: vi.fn() };
    startScheduler({ ingest, intervalMin: 5 });
    stopScheduler();
    expect(stopHandle.stop).toHaveBeenCalledTimes(1);
  });

  it('stopScheduler is a no-op if nothing is scheduled', () => {
    expect(() => stopScheduler()).not.toThrow();
  });
});
