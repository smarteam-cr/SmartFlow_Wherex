function loadSlackConfig(env = process.env, { sharedPollIntervalMin } = {}) {
  const errors = [];

  function req(name) {
    const v = env[name];
    if (!v || String(v).trim() === '') {
      errors.push(`Missing required env var: ${name}`);
    }
    return v;
  }

  const botToken = req('SLACK_BOT_TOKEN');
  const channelId = req('SLACK_CHANNEL_ID');
  const hubspotToken = req('SLACK_HUBSPOT_TOKEN');
  const hubspotAppSecret = req('SLACK_HUBSPOT_APP_SECRET');
  const hubspotPipelineId = req('SLACK_HUBSPOT_PIPELINE_ID');
  const hubspotStageNewId = req('SLACK_HUBSPOT_STAGE_NEW_ID');
  const hubspotStageCompletedId = req('SLACK_HUBSPOT_STAGE_COMPLETED_ID');

  let pollIntervalMin;
  if (sharedPollIntervalMin !== undefined) {
    pollIntervalMin = sharedPollIntervalMin;
  } else if (env.POLL_INTERVAL_MIN) {
    const n = Number.parseInt(env.POLL_INTERVAL_MIN, 10);
    pollIntervalMin = Number.isInteger(n) && n > 0 ? n : 5;
  } else {
    pollIntervalMin = 5;
  }
  if (env.SLACK_POLL_INTERVAL_MIN) {
    const n = Number.parseInt(env.SLACK_POLL_INTERVAL_MIN, 10);
    if (Number.isInteger(n) && n > 0) {
      pollIntervalMin = n;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    values: {
      SLACK_BOT_TOKEN: botToken,
      SLACK_CHANNEL_ID: channelId,
      SLACK_HUBSPOT_TOKEN: hubspotToken,
      SLACK_HUBSPOT_APP_SECRET: hubspotAppSecret,
      SLACK_HUBSPOT_PIPELINE_ID: hubspotPipelineId,
      SLACK_HUBSPOT_STAGE_NEW_ID: hubspotStageNewId,
      SLACK_HUBSPOT_STAGE_COMPLETED_ID: hubspotStageCompletedId,
      POLL_INTERVAL_MIN: pollIntervalMin,
    },
  };
}

module.exports = { loadSlackConfig };