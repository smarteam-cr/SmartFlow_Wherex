import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REQUIRED = {
  JIRA_BASE_URL: 'https://org.atlassian.net',
  JIRA_EMAIL: 'svc@example.com',
  JIRA_API_TOKEN: 'token-abc',
  JIRA_PROJECT_KEY: 'PROJ',
  HUBSPOT_TOKEN: 'pat-na1-test',
  WEBHOOK_SECRET: 'whsec-test',
  MONGO_URI: 'mongodb://localhost:27017/test',
};

function setEnv(overrides = {}) {
  const vars = { ...REQUIRED, ...overrides };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv() {
  for (const key of [
    ...Object.keys(REQUIRED),
    'PORT',
    'POLL_INTERVAL_MIN',
    'JIRA_TRANSITION_DONE_ID',
  ]) {
    delete process.env[key];
  }
}

function resetConfigModule() {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes(`${path.sep}src${path.sep}config.js`)) {
      delete require.cache[key];
    }
  });
}

describe('config', () => {
  afterEach(() => {
    clearEnv();
    resetConfigModule();
  });

  it('loads a valid env into a structured config object', () => {
    clearEnv();
    setEnv();
    resetConfigModule();
    const config = require('../src/config');
    expect(config.JIRA_BASE_URL).toBe('https://org.atlassian.net');
    expect(config.JIRA_EMAIL).toBe('svc@example.com');
    expect(config.JIRA_API_TOKEN).toBe('token-abc');
    expect(config.JIRA_PROJECT_KEYS).toEqual(['PROJ']);
    expect(config.HUBSPOT_TOKEN).toBe('pat-na1-test');
    expect(config.WEBHOOK_SECRET).toBe('whsec-test');
    expect(config.MONGO_URI).toBe('mongodb://localhost:27017/test');
  });

  it('parses JIRA_PROJECT_KEY as a list when comma-separated, trimming whitespace', () => {
    clearEnv();
    setEnv({ JIRA_PROJECT_KEY: 'PROJ, AUX ,OPS' });
    resetConfigModule();
    const config = require('../src/config');
    expect(config.JIRA_PROJECT_KEYS).toEqual(['PROJ', 'AUX', 'OPS']);
  });

  it('throws when JIRA_BASE_URL is missing', () => {
    clearEnv();
    setEnv({ JIRA_BASE_URL: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/JIRA_BASE_URL/);
  });

  it('throws when JIRA_EMAIL is missing', () => {
    clearEnv();
    setEnv({ JIRA_EMAIL: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/JIRA_EMAIL/);
  });

  it('throws when JIRA_API_TOKEN is missing', () => {
    clearEnv();
    setEnv({ JIRA_API_TOKEN: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/JIRA_API_TOKEN/);
  });

  it('throws when JIRA_PROJECT_KEY is missing', () => {
    clearEnv();
    setEnv({ JIRA_PROJECT_KEY: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/JIRA_PROJECT_KEY/);
  });

  it('throws when HUBSPOT_TOKEN is missing', () => {
    clearEnv();
    setEnv({ HUBSPOT_TOKEN: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/HUBSPOT_TOKEN/);
  });

  it('throws when WEBHOOK_SECRET is missing', () => {
    clearEnv();
    setEnv({ WEBHOOK_SECRET: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/WEBHOOK_SECRET/);
  });

  it('throws when MONGO_URI is missing', () => {
    clearEnv();
    setEnv({ MONGO_URI: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/MONGO_URI/);
  });

  it('applies default POLL_INTERVAL_MIN=5 and PORT=3000', () => {
    clearEnv();
    setEnv();
    resetConfigModule();
    const config = require('../src/config');
    expect(config.POLL_INTERVAL_MIN).toBe(5);
    expect(config.PORT).toBe(3000);
  });

  it('respects explicit POLL_INTERVAL_MIN and PORT', () => {
    clearEnv();
    setEnv({ POLL_INTERVAL_MIN: '10', PORT: '4000' });
    resetConfigModule();
    const config = require('../src/config');
    expect(config.POLL_INTERVAL_MIN).toBe(10);
    expect(config.PORT).toBe(4000);
  });

  it('throws when POLL_INTERVAL_MIN is not a positive integer', () => {
    clearEnv();
    setEnv({ POLL_INTERVAL_MIN: 'abc' });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/POLL_INTERVAL_MIN/);
  });

  it('keeps JIRA_TRANSITION_DONE_ID undefined when absent', () => {
    clearEnv();
    setEnv();
    resetConfigModule();
    const config = require('../src/config');
    expect(config.JIRA_TRANSITION_DONE_ID).toBeUndefined();
  });

  it('parses JIRA_TRANSITION_DONE_ID as a string when present', () => {
    clearEnv();
    setEnv({ JIRA_TRANSITION_DONE_ID: '31' });
    resetConfigModule();
    const config = require('../src/config');
    expect(config.JIRA_TRANSITION_DONE_ID).toBe('31');
  });

  it('strips a trailing slash from JIRA_BASE_URL', () => {
    clearEnv();
    setEnv({ JIRA_BASE_URL: 'https://org.atlassian.net/' });
    resetConfigModule();
    const config = require('../src/config');
    expect(config.JIRA_BASE_URL).toBe('https://org.atlassian.net');
  });
});
