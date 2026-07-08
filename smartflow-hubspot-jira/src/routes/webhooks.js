const express = require('express');

function createWebhooksRouter({ secret } = {}) {
  const router = express.Router();

  router.post('/', (req, res) => {
    res.status(501).json({ error: 'not implemented yet' });
  });

  return router;
}

module.exports = createWebhooksRouter;
module.exports.createWebhooksRouter = createWebhooksRouter;
