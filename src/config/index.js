const { loadSharedConfig } = require('./shared');
const { loadJiraConfig } = require('./jira');
const { loadSlackConfig } = require('./slack');

function loadConfig(env = process.env) {
  let shared;
  try {
    shared = { ok: true, errors: [], values: loadSharedConfig(env) };
  } catch (err) {
    shared = { ok: false, errors: [err.message], values: null };
  }

  const sharedPollIntervalMin = shared.ok ? shared.values.POLL_INTERVAL_MIN : 5;
  const jira = loadJiraConfig(env, { sharedPollIntervalMin });
  const slack = loadSlackConfig(env, { sharedPollIntervalMin });

  const canStart = shared.ok && (jira.ok || slack.ok);

  return { shared, jira, slack, canStart };
}

module.exports = { loadConfig };
module.exports.loadConfig = loadConfig;