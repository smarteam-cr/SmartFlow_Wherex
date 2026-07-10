import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadJiraConfig } = require('../../src/config/jira');

const VALID = {
  JIRA_BASE_URL: 'https://org.atlassian.net',
  JIRA_EMAIL: 'svc@example.com',
  JIRA_API_TOKEN: 'token-abc',
  JIRA_PROJECT_KEY: 'PROJ',
  JIRA_HUBSPOT_TOKEN: 'pat-na1-test',
  JIRA_HUBSPOT_APP_SECRET: 'app-secret',
  JIRA_HUBSPOT_PIPELINE_ID: 'pipeline-1',
  JIRA_HUBSPOT_STAGE_NEW_ID: 'stage-new',
  JIRA_HUBSPOT_STAGE_CLOSED_ID: 'stage-closed',
};

function clearEnv() {
  for (const key of [
    'JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY',
    'JIRA_HUBSPOT_TOKEN', 'JIRA_HUBSPOT_APP_SECRET',
    'JIRA_HUBSPOT_PIPELINE_ID', 'JIRA_HUBSPOT_STAGE_NEW_ID', 'JIRA_HUBSPOT_STAGE_CLOSED_ID',
    'JIRA_TRANSITION_DONE_ID', 'JIRA_POLL_INTERVAL_MIN', 'POLL_INTERVAL_MIN',
  ]) delete process.env[key];
}

function setEnv(overrides = {}) {
  const vars = { ...VALID, ...overrides };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('config/jira.loadJiraConfig', () => {
  it('returns ok=true with all parsed values when env is complete', () => {
    clearEnv();
    setEnv();
    const result = loadJiraConfig(process.env);
    expect(result.ok).toBe(true);
    expect(result.values.JIRA_BASE_URL).toBe('https://org.atlassian.net');
    expect(result.values.JIRA_EMAIL).toBe('svc@example.com');
    expect(result.values.JIRA_API_TOKEN).toBe('token-abc');
    expect(result.values.JIRA_PROJECT_KEYS).toEqual(['PROJ']);
    expect(result.errors).toEqual([]);
  });

  it('returns ok=false with errors[] (NEVER throws) when required vars are missing', () => {
    clearEnv();
    setEnv({ JIRA_API_TOKEN: undefined, JIRA_PROJECT_KEY: undefined });
    const result = loadJiraConfig(process.env);
    expect(result.ok).toBe(false);
    expect(result.errors).toBeInstanceOf(Array);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).toMatch(/JIRA_API_TOKEN/);
    expect(result.errors.join(' ')).toMatch(/JIRA_PROJECT_KEY/);
  });

  it('parses JIRA_PROJECT_KEY as a comma-separated list, trimming whitespace', () => {
    clearEnv();
    setEnv({ JIRA_PROJECT_KEY: 'PROJ, AUX ,OPS' });
    const result = loadJiraConfig(process.env);
    expect(result.ok).toBe(true);
    expect(result.values.JIRA_PROJECT_KEYS).toEqual(['PROJ', 'AUX', 'OPS']);
  });

  it('strips trailing slash from JIRA_BASE_URL', () => {
    clearEnv();
    setEnv({ JIRA_BASE_URL: 'https://org.atlassian.net/' });
    const result = loadJiraConfig(process.env);
    expect(result.values.JIRA_BASE_URL).toBe('https://org.atlassian.net');
  });

  it('keeps JIRA_TRANSITION_DONE_ID undefined when absent', () => {
    clearEnv();
    setEnv();
    const result = loadJiraConfig(process.env);
    expect(result.values.JIRA_TRANSITION_DONE_ID).toBeUndefined();
  });

  it('parses JIRA_TRANSITION_DONE_ID as a string when present', () => {
    clearEnv();
    setEnv({ JIRA_TRANSITION_DONE_ID: '31' });
    const result = loadJiraConfig(process.env);
    expect(result.values.JIRA_TRANSITION_DONE_ID).toBe('31');
  });

  it('uses JIRA_POLL_INTERVAL_MIN when set, falling back to POLL_INTERVAL_MIN', () => {
    clearEnv();
    setEnv();
    delete process.env.JIRA_POLL_INTERVAL_MIN;
    process.env.POLL_INTERVAL_MIN = '7';
    const result = loadJiraConfig(process.env);
    expect(result.values.POLL_INTERVAL_MIN).toBe(7);

    process.env.JIRA_POLL_INTERVAL_MIN = '3';
    const result2 = loadJiraConfig(process.env);
    expect(result2.values.POLL_INTERVAL_MIN).toBe(3);
  });

  it('errors on missing required HubSpot token/app_secret (the plan requirement)', () => {
    clearEnv();
    setEnv({ JIRA_HUBSPOT_TOKEN: undefined, JIRA_HUBSPOT_APP_SECRET: undefined });
    const result = loadJiraConfig(process.env);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/JIRA_HUBSPOT_TOKEN/);
    expect(result.errors.join(' ')).toMatch(/JIRA_HUBSPOT_APP_SECRET/);
  });

  it('does NOT throw when an unrelated env var is missing (only its own required set)', () => {
    clearEnv();
    setEnv({ JIRA_HUBSPOT_TOKEN: undefined });
    expect(() => loadJiraConfig(process.env)).not.toThrow();
  });
});