import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadSharedConfig } = require('../../src/config/shared');

function clearEnv() {
  delete process.env.PORT;
  delete process.env.MONGO_URI;
  delete process.env.MONGO_DB_NAME;
  delete process.env.POLL_INTERVAL_MIN;
  delete process.env.JIRA_POLL_INTERVAL_MIN;
  delete process.env.SLACK_POLL_INTERVAL_MIN;
}

describe('config/shared.loadSharedConfig', () => {
  it('returns the parsed config without throwing', () => {
    clearEnv();
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
    const cfg = loadSharedConfig();
    expect(cfg.MONGO_URI).toBe('mongodb://localhost:27017/test');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.POLL_INTERVAL_MIN).toBe(5);
  });

  it('throws when MONGO_URI is missing (the only required shared var)', () => {
    clearEnv();
    expect(() => loadSharedConfig()).toThrow(/MONGO_URI/);
  });

  it('respects explicit PORT', () => {
    clearEnv();
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
    process.env.PORT = '4000';
    const cfg = loadSharedConfig();
    expect(cfg.PORT).toBe(4000);
  });

  it('respects explicit POLL_INTERVAL_MIN', () => {
    clearEnv();
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
    process.env.POLL_INTERVAL_MIN = '15';
    const cfg = loadSharedConfig();
    expect(cfg.POLL_INTERVAL_MIN).toBe(15);
  });

  it('throws when POLL_INTERVAL_MIN is not a positive integer', () => {
    clearEnv();
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
    process.env.POLL_INTERVAL_MIN = 'abc';
    expect(() => loadSharedConfig()).toThrow(/POLL_INTERVAL_MIN/);
    process.env.POLL_INTERVAL_MIN = '0';
    expect(() => loadSharedConfig()).toThrow(/POLL_INTERVAL_MIN/);
    process.env.POLL_INTERVAL_MIN = '-1';
    expect(() => loadSharedConfig()).toThrow(/POLL_INTERVAL_MIN/);
  });

  it('accepts optional MONGO_DB_NAME', () => {
    clearEnv();
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
    process.env.MONGO_DB_NAME = 'wherenex_test';
    const cfg = loadSharedConfig();
    expect(cfg.MONGO_DB_NAME).toBe('wherenex_test');
  });
});