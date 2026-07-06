const express = require('express');
const config = require('./config');
const mongo = require('./db/mongo');
const slack = require('./services/slack');
const hubspot = require('./services/hubspot');
const { createWebhookRouter } = require('./routes/webhooks');
const { startScheduler } = require('./scheduler');
const { createIngestJob } = require('./jobs/ingestSlack');

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.use(
    '/webhooks/hubspot',
    createWebhookRouter({
      appSecret: config.HUBSPOT_APP_SECRET,
      hsStageCompletedId: config.HS_STAGE_COMPLETED_ID,
      hubspot,
      slack,
    })
  );

  return app;
}

async function start() {
  await mongo.connect(config.MONGO_URI);

  const ingest = createIngestJob({
    channel: config.SLACK_CHANNEL_ID,
    mongo,
    slack,
    hubspot,
    pollIntervalMin: config.POLL_INTERVAL_MIN,
  });
  startScheduler(ingest, config.POLL_INTERVAL_MIN);

  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`Listening on port ${config.PORT}`);
  });
}

module.exports = { createApp, start };

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
