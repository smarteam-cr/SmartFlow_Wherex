import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const request = require('supertest');
const Fastify = require('fastify');
const { createApp, installRawBodyParser } = require('../../src/app');

const APP_SECRET = 'test-app-secret';
const CLOSED_STAGE_ID = 'stage-closed';

let buildJiraWebhooksRouter;
let jira;
let hubspot;

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

function buildApp({ jira: jiraMock, hubspot: hubspotMock, appSecret = APP_SECRET, transitionDoneId, closedStageId = CLOSED_STAGE_ID }) {
  const webhooks = buildJiraWebhooksRouter({
    appSecret,
    closedStageId,
    jira: jiraMock,
    hubspot: hubspotMock,
    transitionDoneId,
  });
  return createApp({ mongo: { ping: async () => {} }, jira: { webhooks } });
}

beforeEach(() => {
  delete require.cache[require.resolve('../../src/routes/jira/webhooks')];
  ({ buildJiraWebhooksRouter } = require('../../src/routes/jira/webhooks'));
  jira = { respondToIssue: vi.fn() };
  hubspot = { getTicket: vi.fn(), updateTicket: vi.fn() };
});

describe('modules/jira/webhooks', () => {
  describe('auth', () => {
    it('returns 401 when no signature header is present', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(401);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      await app.close();
    });

    it('returns 401 when the signature is wrong', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', 'bogus')
        .send(body);
      expect(res.status).toBe(401);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('happy path', () => {
    it('calls respondToIssue, updates the ticket with jira_listo_sent and jira_comment_id, returns 200', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      hubspot.getTicket.mockResolvedValue({
        jira_issue_key: 'PROJ-1',
        jira_listo_sent: 'false',
      });
      jira.respondToIssue.mockResolvedValue('comment-99');
      hubspot.updateTicket.mockResolvedValue({});

      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(hubspot.getTicket).toHaveBeenCalledWith('ticket-1', expect.arrayContaining(['jira_issue_key', 'jira_comment_id', 'jira_listo_sent']));
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', { transitionDoneId: '31' });
      expect(hubspot.updateTicket).toHaveBeenCalledWith('ticket-1', {
        jira_comment_id: 'comment-99',
        jira_listo_sent: 'true',
      });
      await app.close();
    });

    it('passes undefined transitionDoneId when not configured', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: undefined });
      await app.ready();
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' });
      jira.respondToIssue.mockResolvedValue('c1');
      hubspot.updateTicket.mockResolvedValue({});
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', { transitionDoneId: undefined });
      await app.close();
    });

    it('processes multiple events in a single batch', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
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
      const body = JSON.stringify(events);
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).toHaveBeenCalledTimes(2);
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', expect.any(Object));
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-2', expect.any(Object));
      await app.close();
    });
  });

  describe('skip paths (idempotency / non-actionable)', () => {
    it('ignores events whose propertyValue is not the closed stage', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const body = JSON.stringify(ticketClosedEvent({ propertyValue: 'stage-open' }));
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      await app.close();
    });

    it('ignores events for a different property', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const body = JSON.stringify(ticketClosedEvent({ propertyName: 'hs_ticket_priority' }));
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      await app.close();
    });

    it('ignores events with a different subscriptionType', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const body = JSON.stringify(ticketClosedEvent({ subscriptionType: 'ticket.creation' }));
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      await app.close();
    });

    it('returns 200 without acting when the ticket has no jira_issue_key', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      hubspot.getTicket.mockResolvedValue({ jira_listo_sent: 'false' });
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).not.toHaveBeenCalled();
      await app.close();
    });

    it('returns 200 without acting when jira_listo_sent is already true', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'true' });
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).not.toHaveBeenCalled();
      expect(hubspot.updateTicket).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('error paths', () => {
    it('skips the event and returns 200 when hubspot.getTicket 404s (ticket deleted)', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const err = new Error('HubSpot 404: not here');
      err.status = 404;
      hubspot.getTicket.mockRejectedValue(err);
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).not.toHaveBeenCalled();
      await app.close();
    });

    it('returns 500 when hubspot.getTicket throws a non-404 error (HubSpot will retry)', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      hubspot.getTicket.mockRejectedValue(new Error('HubSpot 500: boom'));
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(500);
      await app.close();
    });

    it('returns 500 when jira.respondToIssue throws (HubSpot will retry)', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' });
      jira.respondToIssue.mockRejectedValue(new Error('JIRA 503'));
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(500);
      expect(hubspot.updateTicket).not.toHaveBeenCalled();
      await app.close();
    });

    it('returns 500 when hubspot.updateTicket throws (HubSpot will retry)', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false' });
      jira.respondToIssue.mockResolvedValue('comment-99');
      hubspot.updateTicket.mockRejectedValue(new Error('HubSpot 500'));
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(500);
      await app.close();
    });
  });

  describe('Fastify integration', () => {
    it('rejects malformed JSON with 400 on the content type parser', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const res = await request(app.server)
        .post('/jira/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .send('{not json');
      expect(res.status).toBe(400);
      await app.close();
    });

    it('only accepts the jira webhook at /jira/webhooks/hubspot, not at the slack path', async () => {
      const app = buildApp({ jira, hubspot, transitionDoneId: '31' });
      await app.ready();
      const res = await request(app.server).post('/slack/webhooks/hubspot').send({});
      expect(res.status).toBe(404);
      await app.close();
    });

    it('plugin can be registered without the /jira prefix for backward compat', async () => {
      const plugin = buildJiraWebhooksRouter({
        appSecret: APP_SECRET,
        closedStageId: CLOSED_STAGE_ID,
        jira,
        hubspot,
        transitionDoneId: '31',
      });
      const app = Fastify();
      installRawBodyParser(app);
      await app.register(plugin);
      await app.ready();
      const body = JSON.stringify(ticketClosedEvent());
      const res = await request(app.server)
        .post('/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);
      expect(res.status).toBe(200);
      await app.close();
    });
  });
});