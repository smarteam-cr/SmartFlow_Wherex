const express = require('express');
const config = require('./config');
const mongo = require('./db/mongo');
const createHealthRouter = require('./routes/health');
const createWebhooksRouter = require('./routes/webhooks');

function createApp({ mongo: mongoClient = mongo } = {}) {
  const app = express();
  app.set('trust proxy', true);

  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter({ mongo: mongoClient }));
  app.use('/webhooks/hubspot', createWebhooksRouter({ secret: config.WEBHOOK_SECRET }));

  return app;
}

async function start() {
  await mongo.connect(config.MONGO_URI);

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`Listening on port ${config.PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down`);
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
