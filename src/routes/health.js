function buildHealthPlugin(mongo) {
  if (!mongo) throw new Error('routes/health: mongo is required');
  return async function healthPlugin(fastify) {
    fastify.get('/healthz', async (request, reply) => {
      try {
        await mongo.ping();
        return { ok: true, mongo: 'up' };
      } catch (err) {
        reply.code(503);
        return { ok: false, mongo: 'down' };
      }
    });
  };
}

module.exports = buildHealthPlugin;
module.exports.buildHealthPlugin = buildHealthPlugin;