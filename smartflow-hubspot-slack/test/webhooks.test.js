import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const express = require('express');
const request = require('supertest');
const { createWebhookRouter } = require('../src/routes/webhooks');

const APP_SECRET = 'test-app-secret';

let app;
let deps;

function signV1(body) {
  return crypto.createHash('sha256').update(APP_SECRET + body).digest('hex');
}

function ticketCompletedEvent(overrides = {}) {
  return [
    {
      objectId: 't1',
      subscriptionType: 'ticket.propertyChange',
      propertyName: 'hs_pipeline_stage',
      propertyValue: '4',
      ...overrides,
    },
  ];
}

beforeEach(() => {
  deps = {
    appSecret: APP_SECRET,
    hsStageCompletedId: '4',
    hubspot: {
      getTicket: vi.fn().mockResolvedValue({
        id: 't1',
        properties: {
          slack_channel_id: 'C0TEST',
          slack_thread_ts: '1.1',
          slack_listo_sent: 'false',
        },
      }),
      markListoSent: vi.fn().mockResolvedValue(),
    },
    slack: {
      postListo: vi.fn().mockResolvedValue(),
    },
  };

  app = express();
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use('/webhooks/hubspot', createWebhookRouter(deps));
});

describe('POST /webhooks/hubspot', () => {
  it('rejects requests without a valid signature', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send(ticketCompletedEvent());
    expect(res.status).toBe(401);
    expect(deps.slack.postListo).not.toHaveBeenCalled();
  });

  it('posts Listo when a ticket moves to the completed stage', async () => {
    const body = JSON.stringify(ticketCompletedEvent());
    const res = await request(app)
      .post('/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(deps.slack.postListo).toHaveBeenCalledWith('C0TEST', '1.1');
    expect(deps.hubspot.markListoSent).toHaveBeenCalledWith('t1');
  });

  it('ignores property changes that are not the completed stage', async () => {
    const body = JSON.stringify(ticketCompletedEvent({ propertyValue: '1' }));
    const res = await request(app)
      .post('/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(deps.slack.postListo).not.toHaveBeenCalled();
  });

  it('does not repost Listo if the ticket was already marked as sent', async () => {
    deps.hubspot.getTicket.mockResolvedValue({
      id: 't1',
      properties: {
        slack_channel_id: 'C0TEST',
        slack_thread_ts: '1.1',
        slack_listo_sent: 'true',
      },
    });

    const body = JSON.stringify(ticketCompletedEvent());
    const res = await request(app)
      .post('/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(deps.slack.postListo).not.toHaveBeenCalled();
  });

  it('responds 500 instead of hanging when a downstream call fails', async () => {
    deps.hubspot.getTicket.mockRejectedValue(new Error('HubSpot 500: boom'));

    const body = JSON.stringify(ticketCompletedEvent());
    const res = await request(app)
      .post('/webhooks/hubspot')
      .set('Content-Type', 'application/json')
      .set('x-hubspot-signature', signV1(body))
      .send(body);

    expect(res.status).toBe(500);
  });
});
