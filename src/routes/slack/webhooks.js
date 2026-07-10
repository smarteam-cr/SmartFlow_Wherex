const { isValidSignature } = require('../../shared/hubspotSignature');

function buildSlackWebhooksRouter({ appSecret, stageCompletedId, slack, hubspot } = {}) {
  if (!slack) throw new Error('buildSlackWebhooksRouter: slack is required');
  if (!hubspot) throw new Error('buildSlackWebhooksRouter: hubspot is required');

  return async function slackWebhooksPlugin(fastify) {
    fastify.post('/webhooks/hubspot', async (request, reply) => {
      try {
        const proto = request.headers['x-forwarded-proto'] || request.protocol || 'http';
        const host = request.headers['x-forwarded-host'] || request.headers.host;
        const url = `${proto}://${host}${request.url}`;
        const rawBody = request.rawBody ? request.rawBody.toString('utf8') : '';

        const valid = isValidSignature({
          appSecret,
          method: request.method,
          url,
          rawBody,
          timestamp: request.headers['x-hubspot-request-timestamp'],
          signatureV3: request.headers['x-hubspot-signature-v3'],
          signatureV1: request.headers['x-hubspot-signature'],
        });

        if (!valid) {
          return reply.code(401).send({ error: 'invalid signature' });
        }

        const events = Array.isArray(request.body) ? request.body : [request.body];

        for (const event of events) {
          if (event.subscriptionType !== 'ticket.propertyChange') continue;
          if (event.propertyName !== 'hs_pipeline_stage') continue;
          if (String(event.propertyValue) !== String(stageCompletedId)) continue;

          const ticketId = event.objectId;
          const ticket = await hubspot.getTicket(ticketId, [
            'slack_channel_id',
            'slack_thread_ts',
            'slack_listo_sent',
          ]);

          if (ticket.properties.slack_listo_sent === 'true') continue;

          const { slack_channel_id: channel, slack_thread_ts: threadTs } = ticket.properties;
          if (!channel || !threadTs) {
            fastify.log.warn(`ticket ${ticketId}: no es de la integración de Slack (falta slack_channel_id/slack_thread_ts), se omite`);
            continue;
          }

          await slack.postListo(channel, String(threadTs));
          await hubspot.markListoSent(ticketId);
        }

        return { ok: true };
      } catch (err) {
        fastify.log.error('webhook handler error:', err);
        return reply.code(500).send({ error: 'internal error' });
      }
    });
  };
}

module.exports = buildSlackWebhooksRouter;
module.exports.buildSlackWebhooksRouter = buildSlackWebhooksRouter;