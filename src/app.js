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

function createApp({ mongo, jira, slack } = {}) {
  if (!mongo) throw new Error('app: mongo is required');
  const app = Fastify({ trustProxy: true });
  installRawBodyParser(app);
  app.register(buildHealthPlugin(mongo));
  if (jira && jira.webhooks) {
    app.register(jira.webhooks, { prefix: '/jira' });
  }
  if (slack && slack.webhooks) {
    app.register(slack.webhooks, { prefix: '/slack' });
  }
  return app;
}

module.exports = { createApp, installRawBodyParser };