function loadConfig(env = process.env) {
  const errors = [];

  const required = {
    JIRA_BASE_URL: env.JIRA_BASE_URL,
    JIRA_EMAIL: env.JIRA_EMAIL,
    JIRA_API_TOKEN: env.JIRA_API_TOKEN,
    JIRA_PROJECT_KEY: env.JIRA_PROJECT_KEY,
    HUBSPOT_TOKEN: env.HUBSPOT_TOKEN,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    MONGO_URI: env.MONGO_URI,
  };

  for (const [key, value] of Object.entries(required)) {
    if (!value || String(value).trim() === '') {
      errors.push(`Missing required env var: ${key}`);
    }
  }

  const pollRaw = env.POLL_INTERVAL_MIN ?? '5';
  const pollIntervalMin = Number.parseInt(pollRaw, 10);
  if (!Number.isInteger(pollIntervalMin) || pollIntervalMin <= 0) {
    errors.push(`POLL_INTERVAL_MIN must be a positive integer, got: ${pollRaw}`);
  }

  if (errors.length > 0) {
    const err = new Error(errors.join('; '));
    err.code = 'CONFIG_INVALID';
    throw err;
  }

  const jiraBaseUrl = String(env.JIRA_BASE_URL).replace(/\/$/, '');

  const jiraProjectKeys = String(env.JIRA_PROJECT_KEY)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    JIRA_BASE_URL: jiraBaseUrl,
    JIRA_EMAIL: env.JIRA_EMAIL,
    JIRA_API_TOKEN: env.JIRA_API_TOKEN,
    JIRA_PROJECT_KEYS: jiraProjectKeys,
    JIRA_TRANSITION_DONE_ID: env.JIRA_TRANSITION_DONE_ID
      ? String(env.JIRA_TRANSITION_DONE_ID)
      : undefined,
    HUBSPOT_TOKEN: env.HUBSPOT_TOKEN,
    POLL_INTERVAL_MIN: pollIntervalMin,
    PORT: Number.parseInt(env.PORT ?? '3000', 10),
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    MONGO_URI: env.MONGO_URI,
  };
}

const config = loadConfig();

module.exports = config;
module.exports.loadConfig = loadConfig;
