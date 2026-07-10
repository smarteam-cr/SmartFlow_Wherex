import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadConfig } = require('../../src/config');

function clearEnv() {
  for (const key of [
    'MONGO_URI', 'MONGO_DB_NAME', 'PORT', 'POLL_INTERVAL_MIN',
    'JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY',
    'JIRA_HUBSPOT_TOKEN', 'JIRA_HUBSPOT_APP_SECRET',
    'JIRA_HUBSPOT_PIPELINE_ID', 'JIRA_HUBSPOT_STAGE_NEW_ID', 'JIRA_HUBSPOT_STAGE_CLOSED_ID',
    'JIRA_TRANSITION_DONE_ID', 'JIRA_POLL_INTERVAL_MIN',
    'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID',
    'SLACK_HUBSPOT_TOKEN', 'SLACK_HUBSPOT_APP_SECRET',
    'SLACK_HUBSPOT_PIPELINE_ID', 'SLACK_HUBSPOT_STAGE_NEW_ID', 'SLACK_HUBSPOT_STAGE_COMPLETED_ID',
    'SLACK_POLL_INTERVAL_MIN',
  ]) delete process.env[key];
}

const JIRA_OK = {
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

const SLACK_OK = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_CHANNEL_ID: 'C0TEST',
  SLACK_HUBSPOT_TOKEN: 'pat-na1-test',
  SLACK_HUBSPOT_APP_SECRET: 'app-secret',
  SLACK_HUBSPOT_PIPELINE_ID: '0',
  SLACK_HUBSPOT_STAGE_NEW_ID: '1',
  SLACK_HUBSPOT_STAGE_COMPLETED_ID: '4',
};

function setEnv(overrides = {}) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('config/index.loadConfig (aggregator)', () => {
  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  it('returns shared+jira+slack shape with both ok=true when all env present', () => {
    setEnv({ MONGO_URI: 'mongodb://localhost:27017/test', ...JIRA_OK, ...SLACK_OK });
    const result = loadConfig(process.env);
    expect(result.shared.MONGO_URI).toBe('mongodb://localhost:27017/test');
    expect(result.jira.ok).toBe(true);
    expect(result.slack.ok).toBe(true);
  });

  it('returns shared.ok=false when MONGO_URI is missing', () => {
    setEnv({ ...JIRA_OK, ...SLACK_OK });
    const result = loadConfig(process.env);
    expect(result.shared.ok).toBe(false);
    expect(result.shared.errors.join(' ')).toMatch(/MONGO_URI/);
  });

  it('returns jira.ok=false but slack.ok=true when only Slack is configured', () => {
    setEnv({ MONGO_URI: 'mongodb://localhost:27017/test', ...SLACK_OK });
    const result = loadConfig(process.env);
    expect(result.shared.ok).toBe(true);
    expect(result.jira.ok).toBe(false);
    expect(result.slack.ok).toBe(true);
    expect(result.canStart).toBe(true);
  });

  it('returns slack.ok=false but jira.ok=true when only Jira is configured', () => {
    setEnv({ MONGO_URI: 'mongodb://localhost:27017/test', ...JIRA_OK });
    const result = loadConfig(process.env);
    expect(result.jira.ok).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.canStart).toBe(true);
  });

  it('returns canStart=false when BOTH jira and slack configs are invalid', () => {
    setEnv({ MONGO_URI: 'mongodb://localhost:27017/test' });
    const result = loadConfig(process.env);
    expect(result.canStart).toBe(false);
  });

  it('returns canStart=false when shared config is invalid even if both integrations are ok', () => {
    setEnv({ ...JIRA_OK, ...SLACK_OK });
    const result = loadConfig(process.env);
    expect(result.shared.ok).toBe(false);
    expect(result.canStart).toBe(false);
  });

  it('NEVER throws, even when ALL env vars are missing', () => {
    clearEnv();
    expect(() => loadConfig(process.env)).not.toThrow();
    const result = loadConfig(process.env);
    expect(result.shared.ok).toBe(false);
    expect(result.jira.ok).toBe(false);
    expect(result.slack.ok).toBe(false);
    expect(result.canStart).toBe(false);
  });

  it('aggregates errors from both integrations without losing them', () => {
    setEnv({ MONGO_URI: 'mongodb://localhost:27017/test' });
    const result = loadConfig(process.env);
    expect(result.jira.errors.length).toBeGreaterThan(0);
    expect(result.slack.errors.length).toBeGreaterThan(0);
  });
});