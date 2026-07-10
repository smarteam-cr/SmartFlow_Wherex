import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const request = require('supertest');
const Fastify = require('fastify');
const { createApp, installRawBodyParser } = require('../../src/app');

const APP_SECRET = 'test-app-secret';
const STAGE_COMPLETED_ID = '4';

let buildSlackWebhooksRouter;
let slack;
let hubspot;

function signV1(body) {
  return crypto.createHash('sha256').update(APP_SECRET + body).digest('hex');
}

function ticketCompletedEvent(overrides = {}) {
  return [
    {
      objectId: 't1',
      subscriptionType: 'ticket.propertyChange',
      propertyName: 'hs_pipeline_stage',
      propertyValue: STAGE_COMPLETED_ID,
      ...overrides,
    },
  ];
}

function buildApp({ slack: slackMock, hubspot: hubspotMock, appSecret = APP_SECRET, stageCompletedId = STAGE_COMPLETED_ID }) {
  const webhooks = buildSlackWebhooksRouter({
    appSecret,
    stageCompletedId,
    slack: slackMock,
    hubspot: hubspotMock,
  });
  return createApp({ mongo: { ping: async () => {} }, slack: { webhooks } });
}

beforeEach(() => {
  delete require.cache[require.resolve('../../src/routes/slack/webhooks')];
  ({ buildSlackWebhooksRouter } = require('../../src/routes/slack/webhooks'));
  slack = { postListo: vi.fn().mockResolvedValue() };
  hubspot = {
    getTicket: vi.fn().mockResolvedValue({
      id: 't1',
      properties: {
        slack_channel_id: 'C0TEST',
        slack_thread_ts: '1.1',
        slack_listo_sent: 'false',
      },
    }),
    markListoSent: vi.fn().mockResolvedValue(),
  };
});

describe('modules/slack/webhooks', () => {
  describe('auth', () => {
    it('rejects requests without a valid signature', async () => {
      const app = buildApp({ slack, hubspot });
      await app.ready();
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .send(ticketCompletedEvent());
      expect(res.status).toBe(401);
      expect(slack.postListo).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('happy path', () => {
    it('posts Listo when a ticket moves to the completed stage', async () => {
      const app = buildApp({ slack, hubspot });
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent());
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(slack.postListo).toHaveBeenCalledWith('C0TEST', '1.1');
      expect(hubspot.markListoSent).toHaveBeenCalledWith('t1');
      await app.close();
    });
  });

  describe('skip paths', () => {
    it('ignores property changes that are not the completed stage', async () => {
      const app = buildApp({ slack, hubspot });
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent({ propertyValue: '1' }));
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(slack.postListo).not.toHaveBeenCalled();
      await app.close();
    });

    it('does not repost Listo if the ticket was already marked as sent', async () => {
      hubspot.getTicket.mockResolvedValue({
        id: 't1',
        properties: {
          slack_channel_id: 'C0TEST',
          slack_thread_ts: '1.1',
          slack_listo_sent: 'true',
        },
      });

      const app = buildApp({ slack, hubspot });
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent());
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(slack.postListo).not.toHaveBeenCalled();
      await app.close();
    });

    it('skips events whose ticket has no slack_channel_id/slack_thread_ts (not from slack integration)', async () => {
      hubspot.getTicket.mockResolvedValue({
        id: 't1',
        properties: { slack_listo_sent: 'false' },
      });

      const app = buildApp({ slack, hubspot });
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent());
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(slack.postListo).not.toHaveBeenCalled();
      await app.close();
    });

    it('ignores events with a different subscriptionType', async () => {
      const app = buildApp({ slack, hubspot });
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent({ subscriptionType: 'ticket.creation' }));
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      await app.close();
    });

    it('ignores events for a different property name', async () => {
      const app = buildApp({ slack, hubspot });
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent({ propertyName: 'hs_ticket_priority' }));
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('error paths', () => {
    it('responds 500 instead of hanging when a downstream call fails', async () => {
      hubspot.getTicket.mockRejectedValue(new Error('HubSpot 500: boom'));

      const app = buildApp({ slack, hubspot });
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent());
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .set('x-hubspot-signature', signV1(body))
        .send(body);

      expect(res.status).toBe(500);
      await app.close();
    });
  });

  describe('Fastify integration', () => {
    it('rejects malformed JSON with 400', async () => {
      const app = buildApp({ slack, hubspot });
      await app.ready();
      const res = await request(app.server)
        .post('/slack/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .send('{not json');
      expect(res.status).toBe(400);
      await app.close();
    });

    it('only accepts the slack webhook at /slack/webhooks/hubspot, not at the jira path', async () => {
      const app = buildApp({ slack, hubspot });
      await app.ready();
      const res = await request(app.server).post('/jira/webhooks/hubspot').send({});
      expect(res.status).toBe(404);
      await app.close();
    });

    it('plugin can be registered without the /slack prefix', async () => {
      hubspot.getTicket.mockResolvedValue({
        id: 't1',
        properties: { slack_channel_id: 'C0TEST', slack_thread_ts: '1.1', slack_listo_sent: 'false' },
      });
      const plugin = buildSlackWebhooksRouter({
        appSecret: APP_SECRET,
        stageCompletedId: STAGE_COMPLETED_ID,
        slack,
        hubspot,
      });
      const app = Fastify();
      installRawBodyParser(app);
      await app.register(plugin);
      await app.ready();
      const body = JSON.stringify(ticketCompletedEvent());
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