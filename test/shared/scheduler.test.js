import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createScheduler } = require('../src/shared/scheduler');

let cron;
let scheduleMock;
let handles;
let scheduler;

beforeEach(() => {
  handles = [];
  scheduleMock = vi.fn((expr, handler) => {
    const h = { stop: vi.fn(), start: vi.fn() };
    h._expr = expr;
    h._handler = handler;
    handles.push(h);
    return h;
  });
  cron = { schedule: scheduleMock };
  scheduler = createScheduler({ cron });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shared/scheduler.createScheduler', () => {
  describe('cron wiring', () => {
    it('schedules a job with expression "*/N * * * *" for interval N', () => {
      scheduler.registerJob({ name: 'jira', ingest: { run: vi.fn() }, intervalMin: 5 });
      expect(scheduleMock).toHaveBeenCalledTimes(1);
      expect(handles[0]._expr).toBe('*/5 * * * *');
      expect(typeof handles[0]._handler).toBe('function');
    });

    it('uses different expressions for different intervals', () => {
      scheduler.registerJob({ name: 'a', ingest: { run: vi.fn() }, intervalMin: 10 });
      scheduler.registerJob({ name: 'b', ingest: { run: vi.fn() }, intervalMin: 30 });
      expect(handles[0]._expr).toBe('*/10 * * * *');
      expect(handles[1]._expr).toBe('*/30 * * * *');
    });

    it('accepts an injectable cron implementation (DI)', () => {
      const customCron = { schedule: vi.fn(() => ({ stop: vi.fn() })) };
      const s = createScheduler({ cron: customCron });
      s.registerJob({ name: 'x', ingest: { run: vi.fn() }, intervalMin: 5 });
      expect(customCron.schedule).toHaveBeenCalledTimes(1);
    });

    it('throws when intervalMin is not an integer in [1, 59]', () => {
      const ingest = { run: vi.fn() };
      expect(() => scheduler.registerJob({ name: 'x', ingest, intervalMin: 0 })).toThrow();
      expect(() => scheduler.registerJob({ name: 'x', ingest, intervalMin: -3 })).toThrow();
      expect(() => scheduler.registerJob({ name: 'x', ingest, intervalMin: 60 })).toThrow();
      expect(() => scheduler.registerJob({ name: 'x', ingest, intervalMin: '5' })).toThrow();
      expect(() => scheduler.registerJob({ name: 'x', ingest, intervalMin: 1.5 })).toThrow();
    });

    it('throws when ingest is missing', () => {
      expect(() => scheduler.registerJob({ name: 'x', intervalMin: 5 })).toThrow(/ingest/);
    });

    it('throws when name is missing or empty', () => {
      const ingest = { run: vi.fn() };
      expect(() => scheduler.registerJob({ ingest, intervalMin: 5 })).toThrow(/name/);
      expect(() => scheduler.registerJob({ name: '', ingest, intervalMin: 5 })).toThrow(/name/);
    });
  });

  describe('invocation contract', () => {
    it('runs the wrapped ingest and swallows errors', async () => {
      const ingest = { run: vi.fn().mockRejectedValue(new Error('boom')) };
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      scheduler.registerJob({ name: 'x', ingest, intervalMin: 5 });
      await expect(handles[0]._handler()).resolves.toBeUndefined();
      expect(ingest.run).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('passes a Date "now" to ingest.run', async () => {
      const ingest = { run: vi.fn().mockResolvedValue() };
      scheduler.registerJob({ name: 'x', ingest, intervalMin: 5 });
      await handles[0]._handler();
      const arg = ingest.run.mock.calls[0][0];
      expect(arg).toHaveProperty('now');
      expect(arg.now).toBeInstanceOf(Date);
    });

    it('logs the job name in the error message', async () => {
      const ingest = { run: vi.fn().mockRejectedValue(new Error('boom')) };
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      scheduler.registerJob({ name: 'jira-ingest', ingest, intervalMin: 5 });
      await handles[0]._handler();
      expect(errorSpy).toHaveBeenCalled();
      const firstArg = errorSpy.mock.calls[0][0];
      expect(String(firstArg)).toMatch(/jira-ingest/);
    });
  });

  describe('overlap guard (from slack)', () => {
    it('skips a second invocation while a previous one is still running', async () => {
      let resolveRun;
      const ingest = {
        run: vi.fn(() => new Promise((resolve) => { resolveRun = resolve; })),
      };
      scheduler.registerJob({ name: 'x', ingest, intervalMin: 5 });
      const first = handles[0]._handler();
      await handles[0]._handler();
      expect(ingest.run).toHaveBeenCalledTimes(1);
      resolveRun();
      await first;
    });

    it('resumes scheduling after a previous invocation finishes', async () => {
      let resolveRun;
      const ingest = {
        run: vi.fn(() => new Promise((resolve) => { resolveRun = resolve; })),
      };
      scheduler.registerJob({ name: 'x', ingest, intervalMin: 5 });
      const first = handles[0]._handler();
      await handles[0]._handler();
      expect(ingest.run).toHaveBeenCalledTimes(1);
      resolveRun();
      await first;
      await handles[0]._handler();
      expect(ingest.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('multi-job registry', () => {
    it('supports N jobs with distinct names and intervals', () => {
      const s = createScheduler({ cron });
      s.registerJob({ name: 'jira', ingest: { run: vi.fn() }, intervalMin: 5 });
      s.registerJob({ name: 'slack', ingest: { run: vi.fn() }, intervalMin: 10 });
      expect(scheduleMock).toHaveBeenCalledTimes(2);
      expect(handles[0]._expr).toBe('*/5 * * * *');
      expect(handles[1]._expr).toBe('*/10 * * * *');
      expect(s.list().sort()).toEqual(['jira', 'slack']);
    });

    it('rejects registering two jobs with the same name', () => {
      scheduler.registerJob({ name: 'jira', ingest: { run: vi.fn() }, intervalMin: 5 });
      expect(() =>
        scheduler.registerJob({ name: 'jira', ingest: { run: vi.fn() }, intervalMin: 10 })
      ).toThrow(/already registered/);
    });

    it('stopJob(name) stops only that job', () => {
      scheduler.registerJob({ name: 'jira', ingest: { run: vi.fn() }, intervalMin: 5 });
      scheduler.registerJob({ name: 'slack', ingest: { run: vi.fn() }, intervalMin: 5 });
      const ok = scheduler.stopJob('jira');
      expect(ok).toBe(true);
      expect(handles[0].stop).toHaveBeenCalledTimes(1);
      expect(handles[1].stop).not.toHaveBeenCalled();
      expect(scheduler.list()).toEqual(['slack']);
    });

    it('stopJob returns false when the job does not exist', () => {
      expect(scheduler.stopJob('nope')).toBe(false);
    });

    it('stopAll stops every registered job', () => {
      scheduler.registerJob({ name: 'jira', ingest: { run: vi.fn() }, intervalMin: 5 });
      scheduler.registerJob({ name: 'slack', ingest: { run: vi.fn() }, intervalMin: 5 });
      scheduler.stopAll();
      expect(handles[0].stop).toHaveBeenCalledTimes(1);
      expect(handles[1].stop).toHaveBeenCalledTimes(1);
      expect(scheduler.list()).toEqual([]);
    });

    it('stopAll is a no-op when no jobs are registered', () => {
      expect(() => scheduler.stopAll()).not.toThrow();
    });
  });
});