const Fastify = require('fastify');
const buildHealthPlugin = require('./routes/health');

function installRawBodyParser(fastify) {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      req.rawBody = body;
      try {
        const parsed = body.length ? JSON.parse(body.toString('utf8')) : {};
        done(null, parsed);
      } catch (err) {
        err.statusCode = 400;
        done(err);
      }
    }
  );
}

function createApp({ mongo, integrations } = {}) {
  if (!mongo) throw new Error('app: mongo is required');
  const app = Fastify({ trustProxy: true });
  installRawBodyParser(app);
  app.register(buildHealthPlugin(mongo));
  return app;
}

module.exports = { createApp, installRawBodyParser };