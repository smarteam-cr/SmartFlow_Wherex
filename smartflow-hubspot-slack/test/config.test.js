import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REQUIRED = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_CHANNEL_ID: 'C0TEST123',
  HUBSPOT_TOKEN: 'pat-na1-test',
  HS_PIPELINE_ID: '0',
  HS_STAGE_NEW_ID: '1',
  HS_STAGE_COMPLETED_ID: '4',
  HUBSPOT_APP_SECRET: 'test-app-secret',
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
  for (const key of [...Object.keys(REQUIRED), 'PORT', 'POLL_INTERVAL_MIN']) {
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

  it('throws when a required env var is missing', () => {
    clearEnv();
    setEnv({ SLACK_BOT_TOKEN: undefined });
    resetConfigModule();
    expect(() => require('../src/config')).toThrow(/SLACK_BOT_TOKEN/);
  });

  it('applies default POLL_INTERVAL_MIN and PORT', () => {
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
});
