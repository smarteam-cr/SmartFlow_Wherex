const { WebClient } = require('@slack/web-api');
const connection = require('./db/connection');
const { createApp } = require('./app');
const { createScheduler } = require('./shared/scheduler');
const { loadConfig } = require('./config');

const createJiraService = require('./modules/jira/services/jira');
const createJiraHubSpotService = require('./modules/jira/services/hubspot');
const createJiraIngestJob = require('./modules/jira/jobs/ingest');
const jiraStore = require('./modules/jira/store');
const { buildJiraWebhooksRouter } = require('./routes/jira/webhooks');

const createSlackService = require('./modules/slack/services/slack').createSlackService;
const createSlackHubSpotService = require('./modules/slack/services/hubspot');
const createSlackIngestJob = require('./modules/slack/jobs/ingest');
const slackStore = require('./modules/slack/store');
const { buildSlackWebhooksRouter } = require('./routes/slack/webhooks');

async function buildJiraIntegration(cfg) {
  const jira = createJiraService({
    baseUrl: cfg.JIRA_BASE_URL,
    email: cfg.JIRA_EMAIL,
    apiToken: cfg.JIRA_API_TOKEN,
  });
  const hubspot = createJiraHubSpotService({
    token: cfg.JIRA_HUBSPOT_TOKEN,
    jiraBaseUrl: cfg.JIRA_BASE_URL,
    pipelineId: cfg.JIRA_HUBSPOT_PIPELINE_ID,
    newStageId: cfg.JIRA_HUBSPOT_STAGE_NEW_ID,
  });
  const ingest = createJiraIngestJob({
    jira,
    hubspot,
    store: jiraStore,
    projects: cfg.JIRA_PROJECT_KEYS,
    pollIntervalMin: cfg.POLL_INTERVAL_MIN,
  });
  const webhooks = buildJiraWebhooksRouter({
    appSecret: cfg.JIRA_HUBSPOT_APP_SECRET,
    closedStageId: cfg.JIRA_HUBSPOT_STAGE_CLOSED_ID,
    jira,
    hubspot,
    transitionDoneId: cfg.JIRA_TRANSITION_DONE_ID,
  });
  return { ingest, webhooks };
}

async function buildSlackIntegration(cfg) {
  const slack = createSlackService({
    client: new WebClient(cfg.SLACK_BOT_TOKEN),
  });
  const hubspot = createSlackHubSpotService({
    token: cfg.SLACK_HUBSPOT_TOKEN,
    pipelineId: cfg.SLACK_HUBSPOT_PIPELINE_ID,
    stageNewId: cfg.SLACK_HUBSPOT_STAGE_NEW_ID,
    stageCompletedId: cfg.SLACK_HUBSPOT_STAGE_COMPLETED_ID,
  });
  const ingest = createSlackIngestJob({
    channel: cfg.SLACK_CHANNEL_ID,
    store: slackStore,
    slack,
    hubspot,
    pollIntervalMin: cfg.POLL_INTERVAL_MIN,
  });
  const webhooks = buildSlackWebhooksRouter({
    appSecret: cfg.SLACK_HUBSPOT_APP_SECRET,
    stageCompletedId: cfg.SLACK_HUBSPOT_STAGE_COMPLETED_ID,
    slack,
    hubspot,
  });
  return { ingest, webhooks };
}

async function start({ config: providedConfig } = {}) {
  const cfg = providedConfig || loadConfig(process.env);

  if (!cfg.shared.ok) {
    const msg = cfg.shared.errors.join('; ');
    throw new Error(`start: shared config invalid — ${msg}`);
  }
  if (!cfg.canStart) {
    throw new Error('start: at least one integration (jira or slack) must be configured');
  }

  await connection.connect(cfg.shared.values.MONGO_URI, cfg.shared.values.MONGO_DB_NAME);

  await jiraStore.ensureIndexes();
  await slackStore.ensureIndexes();

  const scheduler = createScheduler();
  const integrations = {};

  if (cfg.jira.ok) {
    const jira = await buildJiraIntegration(cfg.jira.values);
    integrations.jira = { webhooks: jira.webhooks };
    scheduler.registerJob({
      name: 'jira-ingest',
      ingest: jira.ingest,
      intervalMin: cfg.jira.values.POLL_INTERVAL_MIN,
    });
    console.log('[start] jira integration enabled');
  } else {
    console.warn('[start] jira integration disabled:', cfg.jira.errors.join('; '));
  }

  if (cfg.slack.ok) {
    const slack = await buildSlackIntegration(cfg.slack.values);
    integrations.slack = { webhooks: slack.webhooks };
    scheduler.registerJob({
      name: 'slack-ingest',
      ingest: slack.ingest,
      intervalMin: cfg.slack.values.POLL_INTERVAL_MIN,
    });
    console.log('[start] slack integration enabled');
  } else {
    console.warn('[start] slack integration disabled:', cfg.slack.errors.join('; '));
  }

  const app = createApp({ mongo: connection, ...integrations });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down`);
    scheduler.stopAll();
    try {
      await app.close();
    } finally {
      await connection.close();
      process.exit(0);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: cfg.shared.values.PORT, host: '0.0.0.0' });
  return { app, scheduler };
}

module.exports = { start };

if (require.main === module) {
  require('dotenv').config();
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}