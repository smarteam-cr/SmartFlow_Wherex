const express = require('express');
const crypto = require('crypto');

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function isValidSignature({ appSecret, method, url, rawBody, timestamp, signatureV3, signatureV1 }) {
  if (signatureV3 && timestamp) {
    if (Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_MAX_AGE_MS) return false;
    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(method + url + rawBody + timestamp)
      .digest('base64');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signatureV3);
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  }
  if (signatureV1) {
    const expected = crypto.createHash('sha256').update(appSecret + rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signatureV1);
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  }
  return false;
}

function createWebhooksRouter({ appSecret, closedStageId, jira, hubspot, transitionDoneId } = {}) {
  if (!jira) throw new Error('createWebhooksRouter: jira is required');
  if (!hubspot) throw new Error('createWebhooksRouter: hubspot is required');

  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const proto = req.get('x-forwarded-proto') || req.protocol;
      const host = req.get('x-forwarded-host') || req.get('host');
      const url = `${proto}://${host}${req.originalUrl}`;
      const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';

      const valid = isValidSignature({
        appSecret,
        method: req.method,
        url,
        rawBody,
        timestamp: req.get('x-hubspot-request-timestamp'),
        signatureV3: req.get('x-hubspot-signature-v3'),
        signatureV1: req.get('x-hubspot-signature'),
      });

      if (!valid) {
        return res.status(401).json({ error: 'invalid signature' });
      }

      const events = Array.isArray(req.body) ? req.body : [req.body];

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
            console.warn(`ticket ${ticketId}: not found (404), skipping`);
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

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('webhook handler error:', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}

module.exports = createWebhooksRouter;
module.exports.createWebhooksRouter = createWebhooksRouter;
module.exports.isValidSignature = isValidSignature;
