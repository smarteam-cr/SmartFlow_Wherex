import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const request = require('supertest');

let createWebhooksRouter;
let isValidSignature;
let jira;
let hubspot;
let app;

const APP_SECRET = 'test-app-secret';
const CLOSED_STAGE_ID = 'stage-closed';

function signV1(body) {
  return crypto.createHash('sha256').update(APP_SECRET + body).digest('hex');
}

function ticketClosedEvent(overrides = {}) {
  return [
    {
      objectId: 'ticket-1',
      subscriptionType: 'ticket.propertyChange',
      propertyName: 'hs_pipeline_stage',
      propertyValue: CLOSED_STAGE_ID,
      ...overrides,
    },
  ];
}

function makeApp({ jira: jiraMock, hubspot: hubspotMock, appSecret = APP_SECRET, transitionDoneId, closedStageId = CLOSED_STAGE_ID } = {}) {
  const factory = createWebhooksRouter({
    appSecret,
    closedStageId,
    jira: jiraMock,
    hubspot: hubspotMock,
    transitionDoneId,
  });
  const localApp = express();
  localApp.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  localApp.use('/webhooks/hubspot', factory);
  return localApp;
}

function post(events, { signed = true } = {}) {
  const body = JSON.stringify(events);
  const req = request(app).post('/webhooks/hubspot').set('Content-Type', 'application/json');
  if (signed) req.set('x-hubspot-signature', signV1(body));
  return req.send(body);
}

beforeEach(() => {
  vi.resetModules();
  delete require.cache[require.resolve('../src/routes/webhooks')];
  ({ createWebhooksRouter, isValidSignature } = require('../src/routes/webhooks'));
  jira = {
    respondToIssue: vi.fn(),
  };
  hubspot = {
    getTicket: vi.fn(),
    updateTicket: vi.fn(),
  };
  app = makeApp({ jira, hubspot, transitionDoneId: '31' });
});

describe('isValidSignature', () => {
  it('validates a correct v1 signature', () => {
    const body = JSON.stringify(ticketClosedEvent());
    const valid = isValidSignature({ appSecret: APP_SECRET, rawBody: body, signatureV1: signV1(body) });
    expect(valid).toBe(true);
  });

  it('rejects an incorrect v1 signature', () => {
    const body = JSON.stringify(ticketClosedEvent());
    const valid = isValidSignature({ appSecret: APP_SECRET, rawBody: body, signatureV1: 'not-the-right-hash' });
    expect(valid).toBe(false);
  });

  it('validates a correct v3 signature within the timestamp window', () => {
    const method = 'POST';
    const url = 'https://example.com/webhooks/hubspot';
    const rawBody = JSON.stringify(ticketClosedEvent());
    const timestamp = String(Date.now());
    const signatureV3 = crypto
      .createHmac('sha256', APP_SECRET)
      .update(method + url + rawBody + timestamp)
      .digest('base64');
    const valid = isValidSignature({ appSecret: APP_SECRET, method, url, rawBody, timestamp, signatureV3 });
    expect(valid).toBe(true);
  });

  it('rejects a v3 signature outside the timestamp window', () => {
    const method = 'POST';
    const url = 'https://example.com/webhooks/hubspot';
    const rawBody = JSON.stringify(ticketClosedEvent());
    const timestamp = String(Date.now() - 10 * 60 * 1000); // 10 min old
    const signatureV3 = crypto
      .createHmac('sha256', APP_SECRET)
      .update(method + url + rawBody + timestamp)
      .digest('base64');
    const valid = isValidSignature({ appSecret: APP_SECRET, method, url, rawBody, timestamp, signatureV3 });
    expect(valid).toBe(false);
  });

  it('returns false when neither signature header is present', () => {
    const valid = isValidSignature({ appSecret: APP_SECRET, rawBody: '[]' });
    expect(valid).toBe(false);
  });
});

describe('webhooks /webhooks/hubspot', () => {
  describe('auth', () => {
    it('returns 401 when no signature header is present', async () => {
      const res = await post(ticketClosedEvent(), { signed: false });
      expect(res.status).toBe(401);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
    });

    it('returns 401 when the signature is wrong', async () => {
      const res = await request(app)
        .post('/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', 'bogus')
        .send(JSON.stringify(ticketClosedEvent()));
      expect(res.status).toBe(401);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('calls respondToIssue, updates the ticket with jira_listo_sent and jira_comment_id, returns 200', async () => {
      hubspot.getTicket.mockResolvedValue({
        jira_issue_key: 'PROJ-1',
        jira_listo_sent: 'false',
      });
      jira.respondToIssue.mockResolvedValue('comment-99');
      hubspot.updateTicket.mockResolvedValue({});

      const res = await post(ticketClosedEvent());

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(hubspot.getTicket).toHaveBeenCalledWith('ticket-1', expect.arrayContaining(['jira_issue_key', 'jira_comment_id', 'jira_listo_sent']));
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', { transitionDoneId: '31' });
      expect(hubspot.updateTicket).toHaveBeenCalledWith('ticket-1', {
        jira_comment_id: 'comment-99',
        jira_listo_sent: 'true',
      });
    });

    it('passes undefined transitionDoneId when not configured', async () => {
      const localApp = makeApp({ jira, hubspot, transitionDoneId: undefined });
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' });
      jira.respondToIssue.mockResolvedValue('c1');
      hubspot.updateTicket.mockResolvedValue({});
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(localApp)
        .post('/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', { transitionDoneId: undefined });
    });

    it('processes multiple events in a single batch', async () => {
      hubspot.getTicket.mockImplementation(async (ticketId) => ({
        jira_issue_key: ticketId === 'ticket-1' ? 'PROJ-1' : 'PROJ-2',
        jira_listo_sent: 'false',
      }));
      jira.respondToIssue.mockResolvedValue('comment-x');
      hubspot.updateTicket.mockResolvedValue({});

      const events = [
        { objectId: 'ticket-1', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: CLOSED_STAGE_ID },
        { objectId: 'ticket-2', subscriptionType: 'ticket.propertyChange', propertyName: 'hs_pipeline_stage', propertyValue: CLOSED_STAGE_ID },
      ];
      const res = await post(events);
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).toHaveBeenCalledTimes(2);
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', expect.any(Object));
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-2', expect.any(Object));
    });
  });

  describe('skip paths (idempotency / non-actionable)', () => {
    it('ignores events whose propertyValue is not the closed stage', async () => {
      const res = await post(ticketClosedEvent({ propertyValue: 'stage-open' }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      expect(jira.respondToIssue).not.toHaveBeenCalled();
    });

    it('ignores events for a different property', async () => {
      const res = await post(ticketClosedEvent({ propertyName: 'hs_ticket_priority' }));
      expect(res.status).toBe(200);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
    });

    it('ignores events with a different subscriptionType', async () => {
      const res = await post(ticketClosedEvent({ subscriptionType: 'ticket.creation' }));
      expect(res.status).toBe(200);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
    });

    it('returns 200 without acting when the ticket has no jira_issue_key', async () => {
      hubspot.getTicket.mockResolvedValue({ jira_listo_sent: 'false' });
      const res = await post(ticketClosedEvent());
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).not.toHaveBeenCalled();
    });

    it('returns 200 without acting when jira_listo_sent is already true', async () => {
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'true' });
      const res = await post(ticketClosedEvent());
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).not.toHaveBeenCalled();
      expect(hubspot.updateTicket).not.toHaveBeenCalled();
    });
  });

  describe('error paths', () => {
    it('skips the event and returns 200 when hubspot.getTicket 404s (ticket deleted)', async () => {
      const err = new Error('HubSpot 404: not here');
      err.status = 404;
      hubspot.getTicket.mockRejectedValue(err);
      const res = await post(ticketClosedEvent());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(jira.respondToIssue).not.toHaveBeenCalled();
    });

    it('returns 500 when hubspot.getTicket throws a non-404 error (HubSpot will retry)', async () => {
      hubspot.getTicket.mockRejectedValue(new Error('HubSpot 500: boom'));
      const res = await post(ticketClosedEvent());
      expect(res.status).toBe(500);
    });

    it('returns 500 when jira.respondToIssue throws (HubSpot will retry)', async () => {
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' });
      jira.respondToIssue.mockRejectedValue(new Error('JIRA 503'));
      const res = await post(ticketClosedEvent());
      expect(res.status).toBe(500);
      expect(hubspot.updateTicket).not.toHaveBeenCalled();
    });

    it('returns 500 when hubspot.updateTicket throws (HubSpot will retry)', async () => {
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' });
      jira.respondToIssue.mockResolvedValue('comment-99');
      hubspot.updateTicket.mockRejectedValue(new Error('HubSpot 500'));
      const res = await post(ticketClosedEvent());
      expect(res.status).toBe(500);
    });
  });
});
