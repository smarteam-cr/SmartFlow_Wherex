import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let startScheduler;
let stopScheduler;
let scheduleMock;
let stopHandle;

function freshImport() {
  delete require.cache[require.resolve('../src/scheduler')];
  ({ startScheduler, stopScheduler } = require('../src/scheduler'));
}

beforeEachModule: {
}

describe('scheduler', () => {
  it('schedules a job with the cron expression "*/N * * * *" for the given interval', () => {
    scheduleMock = vi.fn(() => {
      stopHandle = { stop: vi.fn() };
      return stopHandle;
    });
    freshImport();
    const ingest = { run: vi.fn() };
    const cron = { schedule: scheduleMock };
    startScheduler({ ingest, intervalMin: 5, cron });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const [expr, handler] = scheduleMock.mock.calls[0];
    expect(expr).toBe('*/5 * * * *');
    expect(typeof handler).toBe('function');
  });

  it('uses different cron expression for other intervals', () => {
    scheduleMock = vi.fn(() => {
      stopHandle = { stop: vi.fn() };
      return stopHandle;
    });
    freshImport();
    const ingest = { run: vi.fn() };
    const cron = { schedule: scheduleMock };
    startScheduler({ ingest, intervalMin: 10, cron });
    expect(scheduleMock.mock.calls[0][0]).toBe('*/10 * * * *');
  });

  it('runs the wrapped ingest and swallows errors (does not throw synchronously)', async () => {
    scheduleMock = vi.fn(() => {
      stopHandle = { stop: vi.fn() };
      return stopHandle;
    });
    freshImport();
    const ingest = { run: vi.fn().mockRejectedValue(new Error('boom')) };
    const cron = { schedule: scheduleMock };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    startScheduler({ ingest, intervalMin: 5, cron });
    const handler = scheduleMock.mock.calls[0][1];
    await expect(handler()).resolves.toBeUndefined();
    expect(ingest.run).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('passes a Date "now" to ingest.run', async () => {
    scheduleMock = vi.fn(() => {
      stopHandle = { stop: vi.fn() };
      return stopHandle;
    });
    freshImport();
    const ingest = { run: vi.fn() };
    const cron = { schedule: scheduleMock };
    startScheduler({ ingest, intervalMin: 5, cron });
    const handler = scheduleMock.mock.calls[0][1];
    await handler();
    expect(ingest.run).toHaveBeenCalledTimes(1);
    const arg = ingest.run.mock.calls[0][0];
    expect(arg).toHaveProperty('now');
    expect(arg.now).toBeInstanceOf(Date);
  });

  it('stopScheduler calls .stop() on the active handle', () => {
    scheduleMock = vi.fn(() => {
      stopHandle = { stop: vi.fn() };
      return stopHandle;
    });
    freshImport();
    const ingest = { run: vi.fn() };
    const cron = { schedule: scheduleMock };
    startScheduler({ ingest, intervalMin: 5, cron });
    stopScheduler();
    expect(stopHandle.stop).toHaveBeenCalledTimes(1);
  });

  it('stopScheduler is a no-op if nothing is scheduled', () => {
    freshImport();
    expect(() => stopScheduler()).not.toThrow();
  });

  it('throws when intervalMin is invalid', () => {
    scheduleMock = vi.fn(() => ({ stop: vi.fn() }));
    freshImport();
    const ingest = { run: vi.fn() };
    const cron = { schedule: scheduleMock };
    expect(() => startScheduler({ ingest, intervalMin: 0, cron })).toThrow();
    expect(() => startScheduler({ ingest, intervalMin: '5', cron })).toThrow();
    expect(() => startScheduler({ ingest, intervalMin: 70, cron })).toThrow();
  });

  it('throws when ingest is missing', () => {
    scheduleMock = vi.fn(() => ({ stop: vi.fn() }));
    freshImport();
    const cron = { schedule: scheduleMock };
    expect(() => startScheduler({ intervalMin: 5, cron })).toThrow(/ingest/);
  });
});
