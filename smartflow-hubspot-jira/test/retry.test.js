import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const withRetry = require('../src/utils/retry');

function makeErr(status, body = '') {
  const err = new Error(`HTTP ${status}: ${body}`);
  err.status = status;
  err.retryAfterMs = null;
  return err;
}

function makeRetryAfterErr(status, retryAfterMs) {
  const err = makeErr(status, '');
  err.retryAfterMs = retryAfterMs;
  return err;
}

describe('utils/withRetry', () => {
  it('returns the resolved value on first success without sleeping', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on retryable status (5xx) up to N attempts then throws', async () => {
    const fn = vi.fn().mockRejectedValueOnce(makeErr(503, 'down')).mockRejectedValueOnce(makeErr(502, 'gw')).mockRejectedValueOnce(makeErr(500, 'err'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 10 })).rejects.toThrow(/503/);
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(sleep).toHaveBeenCalledTimes(3);
    // Exponential backoff: 10, 20, 40
    expect(sleep.mock.calls[0][0]).toBe(10);
    expect(sleep.mock.calls[1][0]).toBe(20);
    expect(sleep.mock.calls[2][0]).toBe(40);
  });

  it('retries on 429 and respects retryAfterMs when present', async () => {
    const fn = vi.fn().mockRejectedValueOnce(makeRetryAfterErr(429, 250)).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 100 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBe(250); // retryAfterMs wins over backoff
  });

  it('falls back to exponential backoff for 429 when no retryAfterMs', async () => {
    const fn = vi.fn().mockRejectedValueOnce(makeErr(429)).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 50 });
    expect(sleep.mock.calls[0][0]).toBe(50); // baseMs * 2^0
  });

  it('does NOT retry on 4xx (except 429) and throws immediately', async () => {
    const fn = vi.fn().mockRejectedValue(makeErr(400, 'bad'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withRetry(fn, { sleepFn: sleep, retries: 5, baseMs: 10 })).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does NOT retry on 401, 403, 404', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    for (const status of [401, 403, 404]) {
      const fn = vi.fn().mockRejectedValue(makeErr(status));
      await expect(withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 10 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it('treats network errors (no status) as retryable by default', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('respects isRetryable when provided (can mark a 4xx as retryable)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(makeErr(408, 'timeout')).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await withRetry(fn, {
      sleepFn: sleep,
      retries: 3,
      baseMs: 10,
      isRetryable: (err) => err.status === 408,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('succeeds after partial retries within the budget', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeErr(500))
      .mockRejectedValueOnce(makeErr(502))
      .mockResolvedValueOnce('done');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 10 });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('passes the attempt index to the wrapped fn', async () => {
    const fn = vi.fn().mockRejectedValueOnce(makeErr(500)).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await withRetry(fn, { sleepFn: sleep, retries: 3, baseMs: 1 });
    expect(fn.mock.calls[0][0]).toBe(0);
    expect(fn.mock.calls[1][0]).toBe(1);
  });
});