const connection = require('./db/connection');
const { createApp } = require('./app');

async function start({ port = Number(process.env.PORT) || 3000, mongoUri = process.env.MONGO_URI, mongoDbName = process.env.MONGO_DB_NAME } = {}) {
  if (!mongoUri) throw new Error('start: MONGO_URI is required');

  await connection.connect(mongoUri, mongoDbName);

  const app = createApp({ mongo: connection });

  const shutdown = async (signal) => {
    try {
      await app.close();
      await connection.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port, host: '0.0.0.0' });
  return app;
}

module.exports = { start };

if (require.main === module) {
  require('dotenv').config();
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}