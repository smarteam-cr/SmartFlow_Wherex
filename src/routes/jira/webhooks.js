const { isValidSignature } = require('../../shared/hubspotSignature');

function buildJiraWebhooksRouter({ appSecret, closedStageId, jira, hubspot, transitionDoneId } = {}) {
  if (!jira) throw new Error('buildJiraWebhooksRouter: jira is required');
  if (!hubspot) throw new Error('buildJiraWebhooksRouter: hubspot is required');

  return async function jiraWebhooksPlugin(fastify) {
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
          if (String(event.propertyValue) !== String(closedStageId)) continue;

          const ticketId = event.objectId;
          let ticketProps;
          try {
            ticketProps = await hubspot.getTicket(ticketId, [
              'jira_issue_key',
              'jira_comment_id',
              'jira_listo_sent',
            ]);
          } catch (err) {
            if (err && err.status === 404) {
              fastify.log.warn(`ticket ${ticketId}: not found (404), skipping`);
              continue;
            }
            throw err;
          }

          if (ticketProps.jira_listo_sent === 'true') continue;
          if (!ticketProps.jira_issue_key) continue;

          const commentId = await jira.respondToIssue(ticketProps.jira_issue_key, {
            transitionDoneId,
          });

          await hubspot.updateTicket(ticketId, {
            jira_comment_id: commentId,
            jira_listo_sent: 'true',
          });
        }

        return { ok: true };
      } catch (err) {
        fastify.log.error('webhook handler error:', err);
        return reply.code(500).send({ error: 'internal error' });
      }
    });
  };
}

module.exports = buildJiraWebhooksRouter;
module.exports.buildJiraWebhooksRouter = buildJiraWebhooksRouter;