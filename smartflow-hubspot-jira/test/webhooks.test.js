import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const request = require('supertest');

let createWebhooksRouter;
let jira;
let hubspot;
let app;

const SECRET = 'whsec-test-secret';
const HEADER = 'x-webhook-token';
const CLOSED_STAGE_ID = 'stage-closed';

function makeApp({ jira: jiraMock, hubspot: hubspotMock, secret = SECRET, transitionDoneId, closedStageId = CLOSED_STAGE_ID } = {}) {
  const factory = createWebhooksRouter({
    secret,
    headerName: HEADER,
    jira: jiraMock,
    hubspot: hubspotMock,
    transitionDoneId,
    closedStageId,
  });
  const localApp = express();
  localApp.use(express.json());
  localApp.use('/webhooks/hubspot', factory);
  return localApp;
}

beforeEach(() => {
  vi.resetModules();
  delete require.cache[require.resolve('../src/routes/webhooks')];
  ({ createWebhooksRouter } = require('../src/routes/webhooks'));
  jira = {
    respondToIssue: vi.fn(),
  };
  hubspot = {
    getTicket: vi.fn(),
    updateTicket: vi.fn(),
  };
  app = makeApp({ jira, hubspot, transitionDoneId: '31' });
});

function post(payload, headers = {}) {
  return request(app)
    .post('/webhooks/hubspot')
    .set(HEADER, SECRET)
    .set('Content-Type', 'application/json')
    .send(payload);
}

describe('webhooks /webhooks/hubspot', () => {
  describe('auth', () => {
    it('returns 401 when the token header is missing', async () => {
      const res = await request(app)
        .post('/webhooks/hubspot')
        .set('Content-Type', 'application/json')
        .send({ objectId: 'ticket-1' });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
    });

    it('returns 401 when the token header is wrong', async () => {
      const res = await request(app)
        .post('/webhooks/hubspot')
        .set(HEADER, 'wrong-token')
        .set('Content-Type', 'application/json')
        .send({ objectId: 'ticket-1' });
      expect(res.status).toBe(401);
      expect(hubspot.getTicket).not.toHaveBeenCalled();
    });

    it('uses a custom header name when configured', async () => {
      const customApp = makeApp({ jira, hubspot, secret: SECRET });
      const res = await request(customApp)
        .post('/webhooks/hubspot')
        .set('X-Custom-Auth', SECRET)
        .set('Content-Type', 'application/json')
        .send({ objectId: 'ticket-1' });
      // The default app uses HEADER, not X-Custom-Auth; this should be 401
      expect(res.status).toBe(401);
    });
  });

  describe('payload validation', () => {
    it('returns 400 when the body has no extractable ticketId', async () => {
      const res = await post({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/ticketId/);
    });

    it('accepts objectId at the top level', async () => {
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false', hs_pipeline_stage: CLOSED_STAGE_ID });
      jira.respondToIssue.mockResolvedValue('comment-99');
      hubspot.updateTicket.mockResolvedValue({});
      const res = await post({ objectId: 'ticket-1' });
      expect(res.status).toBe(200);
      expect(hubspot.getTicket).toHaveBeenCalledWith('ticket-1', expect.arrayContaining(['jira_issue_key', 'hs_pipeline_stage', 'jira_listo_sent']));
    });

    it('accepts ticketId at the top level', async () => {
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false', hs_pipeline_stage: CLOSED_STAGE_ID });
      jira.respondToIssue.mockResolvedValue('comment-1');
      hubspot.updateTicket.mockResolvedValue({});
      const res = await post({ ticketId: 'ticket-2' });
      expect(res.status).toBe(200);
      expect(hubspot.getTicket).toHaveBeenCalledWith('ticket-2', expect.any(Array));
    });
  });

  describe('happy path', () => {
    it('calls respondToIssue, updates the ticket with jira_listo_sent and jira_comment_id, returns 200', async () => {
      hubspot.getTicket.mockResolvedValue({
        jira_issue_key: 'PROJ-1',
        jira_listo_sent: 'false',
        hs_pipeline_stage: CLOSED_STAGE_ID,
      });
      jira.respondToIssue.mockResolvedValue('comment-99');
      hubspot.updateTicket.mockResolvedValue({});

      const res = await post({ objectId: 'ticket-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, commentId: 'comment-99' });
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', { transitionDoneId: '31' });
      expect(hubspot.updateTicket).toHaveBeenCalledWith('ticket-1', {
        jira_comment_id: 'comment-99',
        jira_listo_sent: 'true',
      });
    });

    it('passes undefined transitionDoneId when not configured', async () => {
      const localApp = makeApp({ jira, hubspot, transitionDoneId: undefined });
      hubspot.getTicket.mockResolvedValue({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'false', hs_pipeline_stage: CLOSED_STAGE_ID });
      jira.respondToIssue.mockResolvedValue('c1');
      hubspot.updateTicket.mockResolvedValue({});
      const res = await request(localApp)
        .post('/webhooks/hubspot')
        .set(HEADER, SECRET)
        .send({ objectId: 'ticket-1' });
      expect(res.status).toBe(200);
      expect(jira.respondToIssue).toHaveBeenCalledWith('PROJ-1', { transitionDoneId: undefined });
    });
  });

  describe('skip paths (idempotency / non-actionable)', () => {
    it('returns 200 skipped:gone when the ticket was deleted (404)', async () => {
      const err = new Error('HubSpot 404: not here');
      err.status = 404;
      hubspot.getTicket.mockRejectedValue(err);

      const res = await post({ objectId: 'ticket-gone' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, skipped: 'gone' });
      expect(jira.respondToIssue).not.toHaveBeenCalled();
    });

    it('returns 200 skipped:not_done when hs_pipeline_stage is not the closed stage', async () => {
      hubspot.getTicket.mockResolvedValue({
        jira_issue_key: 'PROJ-1',
        jira_listo_sent: 'false',
        hs_pipeline_stage: 'stage-open',
      });
      const res = await post({ objectId: 'ticket-1' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, skipped: 'not_done' });
      expect(jira.respondToIssue).not.toHaveBeenCalled();
    });

    it('returns 200 skipped:no_key when the ticket has no jira_issue_key', async () => {
      hubspot.getTicket.mockResolvedValue({
        jira_listo_sent: 'false',
        hs_pipeline_stage: CLOSED_STAGE_ID,
      });
      const res = await post({ objectId: 'ticket-1' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, skipped: 'no_key' });
      expect(jira.respondToIssue).not.toHaveBeenCalled();
    });

    it('returns 200 skipped:duplicate when jira_listo_sent is already true', async () => {
      hubspot.getTicket.mockResolvedValue({
        jira_issue_key: 'PROJ-1',
        jira_listo_sent: 'true',
        hs_pipeline_stage: CLOSED_STAGE_ID,
      });
      const res = await post({ objectId: 'ticket-1' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, skipped: 'duplicate' });
      expect(jira.respondToIssue).not.toHaveBeenCalled();
      expect(hubspot.updateTicket).not.toHaveBeenCalled();
    });
  });

  describe('error paths', () => {
    it('returns 500 when jira.respondToIssue throws (HubSpot will retry)', async () => {
      hubspot.getTicket.mockResolvedValue({
        jira_issue_key: 'PROJ-1',
        jira_listo_sent: 'false',
        hs_pipeline_stage: CLOSED_STAGE_ID,
      });
      jira.respondToIssue.mockRejectedValue(new Error('JIRA 503'));
      const res = await post({ objectId: 'ticket-1' });
      expect(res.status).toBe(500);
      expect(hubspot.updateTicket).not.toHaveBeenCalled();
    });

    it('returns 500 when hubspot.updateTicket throws (HubSpot will retry)', async () => {
      hubspot.getTicket.mockResolvedValue({
        jira_issue_key: 'PROJ-1',
        jira_listo_sent: 'false',
        hs_pipeline_stage: CLOSED_STAGE_ID,
      });
      jira.respondToIssue.mockResolvedValue('comment-99');
      hubspot.updateTicket.mockRejectedValue(new Error('HubSpot 500'));
      const res = await post({ objectId: 'ticket-1' });
      expect(res.status).toBe(500);
    });
  });
});
