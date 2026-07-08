const express = require('express');
const config = require('./config');
const mongo = require('./db/mongo');
const createJiraService = require('./services/jira');
const createHubSpotService = require('./services/hubspot');
const createIngestJob = require('./jobs/ingestJira');
const { startScheduler, stopScheduler } = require('./scheduler');
const createHealthRouter = require('./routes/health');
const createWebhooksRouter = require('./routes/webhooks');

function createApp({ mongo: mongoClient = mongo, jira, hubspot, transitionDoneId } = {}) {
  const app = express();
  app.set('trust proxy', true);

  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter({ mongo: mongoClient }));
  app.use(
    '/webhooks/hubspot',
    createWebhooksRouter({
      secret: config.WEBHOOK_SECRET,
      jira,
      hubspot,
      transitionDoneId,
    })
  );

  return app;
}

async function start() {
  await mongo.connect(config.MONGO_URI);

  const jira = createJiraService({
    baseUrl: config.JIRA_BASE_URL,
    email: config.JIRA_EMAIL,
    apiToken: config.JIRA_API_TOKEN,
  });
  const hubspot = createHubSpotService({
    token: config.HUBSPOT_TOKEN,
    jiraBaseUrl: config.JIRA_BASE_URL,
  });
  const ingest = createIngestJob({
    jira,
    hubspot,
    mongo,
    projects: config.JIRA_PROJECT_KEYS,
    pollIntervalMin: config.POLL_INTERVAL_MIN,
  });
  startScheduler({ ingest, intervalMin: config.POLL_INTERVAL_MIN });

  const app = createApp({ jira, hubspot, transitionDoneId: config.JIRA_TRANSITION_DONE_ID });
  const server = app.listen(config.PORT, () => {
    console.log(`Listening on port ${config.PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down`);
    stopScheduler();
    server.close(async () => {
      await mongo.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { createApp, start };

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
