const express = require('express');

function createHealthRouter({ mongo }) {
  const router = express.Router();

  router.get('/healthz', async (req, res) => {
    try {
      await mongo.ping();
      res.status(200).json({ ok: true, mongo: 'up' });
    } catch (err) {
      res.status(503).json({ ok: false, mongo: 'down' });
    }
  });

  return router;
}

module.exports = createHealthRouter;
module.exports.createHealthRouter = createHealthRouter;
