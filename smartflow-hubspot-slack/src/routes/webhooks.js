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

function createWebhookRouter({ appSecret, hsStageCompletedId, hubspot, slack }) {
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
        if (String(event.propertyValue) !== String(hsStageCompletedId)) continue;

        const ticketId = event.objectId;
        const ticket = await hubspot.getTicket(ticketId, [
          'slack_channel_id',
          'slack_thread_ts',
          'slack_listo_sent',
        ]);

        if (ticket.properties.slack_listo_sent === 'true') continue;

        const { slack_channel_id: channel, slack_thread_ts: threadTs } = ticket.properties;
        if (!channel || !threadTs) {
          console.warn(`ticket ${ticketId}: no es de la integración de Slack (falta slack_channel_id/slack_thread_ts), se omite`);
          continue;
        }

        await slack.postListo(channel, String(threadTs));
        await hubspot.markListoSent(ticketId);
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('webhook handler error:', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}

module.exports = { createWebhookRouter, isValidSignature };
