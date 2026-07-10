import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadSlackConfig } = require('../../src/config/slack');

const VALID = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_CHANNEL_ID: 'C0TEST123',
  SLACK_HUBSPOT_TOKEN: 'pat-na1-test',
  SLACK_HUBSPOT_APP_SECRET: 'test-app-secret',
  SLACK_HUBSPOT_PIPELINE_ID: '0',
  SLACK_HUBSPOT_STAGE_NEW_ID: '1',
  SLACK_HUBSPOT_STAGE_COMPLETED_ID: '4',
};

function clearEnv() {
  for (const key of [
    'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID',
    'SLACK_HUBSPOT_TOKEN', 'SLACK_HUBSPOT_APP_SECRET',
    'SLACK_HUBSPOT_PIPELINE_ID', 'SLACK_HUBSPOT_STAGE_NEW_ID', 'SLACK_HUBSPOT_STAGE_COMPLETED_ID',
    'SLACK_POLL_INTERVAL_MIN', 'POLL_INTERVAL_MIN',
  ]) delete process.env[key];
}

function setEnv(overrides = {}) {
  const vars = { ...VALID, ...overrides };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('config/slack.loadSlackConfig', () => {
  it('returns ok=true with all parsed values when env is complete', () => {
    clearEnv();
    setEnv();
    const result = loadSlackConfig(process.env);
    expect(result.ok).toBe(true);
    expect(result.values.SLACK_BOT_TOKEN).toBe('xoxb-test-token');
    expect(result.values.SLACK_CHANNEL_ID).toBe('C0TEST123');
    expect(result.errors).toEqual([]);
  });

  it('returns ok=false with errors[] (NEVER throws) when required vars are missing', () => {
    clearEnv();
    setEnv({ SLACK_BOT_TOKEN: undefined, SLACK_CHANNEL_ID: undefined });
    const result = loadSlackConfig(process.env);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/SLACK_BOT_TOKEN/);
    expect(result.errors.join(' ')).toMatch(/SLACK_CHANNEL_ID/);
  });

  it('uses SLACK_POLL_INTERVAL_MIN when set, falling back to POLL_INTERVAL_MIN', () => {
    clearEnv();
    setEnv();
    delete process.env.SLACK_POLL_INTERVAL_MIN;
    process.env.POLL_INTERVAL_MIN = '12';
    const result = loadSlackConfig(process.env);
    expect(result.values.POLL_INTERVAL_MIN).toBe(12);

    process.env.SLACK_POLL_INTERVAL_MIN = '4';
    const result2 = loadSlackConfig(process.env);
    expect(result2.values.POLL_INTERVAL_MIN).toBe(4);
  });

  it('does NOT throw when an unrelated env var is missing', () => {
    clearEnv();
    setEnv({ SLACK_HUBSPOT_TOKEN: undefined });
    expect(() => loadSlackConfig(process.env)).not.toThrow();
  });

  it('requires the slack-specific HubSpot token/secret (not the same as Jira)', () => {
    clearEnv();
    setEnv({ SLACK_HUBSPOT_TOKEN: undefined });
    const result = loadSlackConfig(process.env);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/SLACK_HUBSPOT_TOKEN/);
  });
});