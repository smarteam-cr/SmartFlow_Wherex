import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let fetchMock;
let hubspot;
let extractDescription;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  delete require.cache[require.resolve('../../src/modules/jira/services/hubspot')];
  delete require.cache[require.resolve('../../src/modules/jira/utils/adf')];
  hubspot = require('../../src/modules/jira/services/hubspot');
  extractDescription = require('../../src/modules/jira/utils/adf');
});

function okJson(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}
function errJson(status, body = 'bad') {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

const noRetry = (fn) => fn();

function newHubspot(overrides = {}) {
  return hubspot({
    token: overrides.token ?? 'pat-na1-test',
    jiraBaseUrl: overrides.jiraBaseUrl ?? 'https://org.atlassian.net',
    pipelineId: overrides.pipelineId ?? 'pipeline-1',
    newStageId: overrides.newStageId ?? 'stage-new',
    withRetry: overrides.withRetry ?? noRetry,
  });
}

function sampleIssue(overrides = {}) {
  return {
    key: 'PROJ-1',
    fields: {
      summary: 'Bug en login',
      description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'detalle' }] }] },
      reporter: { displayName: 'Ana' },
      assignee: { displayName: 'Beto' },
      project: { key: 'PROJ' },
      updated: '2026-07-08T10:00:00.000+0000',
    },
    ...overrides,
  };
}

describe('modules/jira/services/hubspot', () => {
  describe('findTicketByJiraKey', () => {
    it('returns null when no tickets match', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ total: 0, results: [] }));
      const s = newHubspot();
      const found = await s.findTicketByJiraKey('PROJ-1');
      expect(found).toBeNull();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tickets/search');
      const body = JSON.parse(opts.body);
      expect(body.filterGroups[0].filters[0]).toEqual({ propertyName: 'jira_issue_key', operator: 'EQ', value: 'PROJ-1' });
    });

    it('returns the first result when total > 0', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ total: 1, results: [{ id: 'ticket-1', properties: { jira_issue_key: 'PROJ-1' } }] }));
      const s = newHubspot();
      const found = await s.findTicketByJiraKey('PROJ-1');
      expect(found).toEqual({ id: 'ticket-1', properties: { jira_issue_key: 'PROJ-1' } });
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(errJson(500, 'boom'));
      const s = newHubspot();
      await expect(s.findTicketByJiraKey('PROJ-1')).rejects.toThrow(/HubSpot 500/);
    });
  });

  describe('createTicket', () => {
    it('sends the expected ticket body with summary, jira props, and returns parsed result', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
      const s = newHubspot();
      const result = await s.createTicket(sampleIssue());
      expect(result).toEqual({ id: 'ticket-1' });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tickets');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.properties.subject).toBe('Bug en login');
      expect(body.properties.hs_pipeline).toBe('pipeline-1');
      expect(body.properties.hs_pipeline_stage).toBe('stage-new');
      expect(body.properties.hs_ticket_priority).toBe('MEDIUM');
      expect(body.properties.content).toBe('detalle');
      expect(body.properties.jira_issue_key).toBe('PROJ-1');
      expect(body.properties.jira_project_key).toBe('PROJ');
      expect(body.properties.jira_url).toBe('https://org.atlassian.net/browse/PROJ-1');
      expect(body.properties.jira_reporter).toBe('Ana');
      expect(body.properties.jira_assignee).toBe('Beto');
    });

    it('truncates subject to 120 chars and falls back to "Issue {key}" if no summary', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
      const s = newHubspot();
      await s.createTicket(sampleIssue({ fields: { summary: 'x'.repeat(200) } }));
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.subject.length).toBe(120);
    });

    it('uses fallback subject when summary is empty', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
      const s = newHubspot();
      await s.createTicket(sampleIssue({ fields: { summary: '' } }));
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.subject).toBe('Issue PROJ-1');
    });

    it('uses fallback subject when summary is missing', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
      const s = newHubspot();
      const issue = { key: 'PROJ-2', fields: { description: null } };
      await s.createTicket(issue);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.subject).toBe('Issue PROJ-2');
    });

    it('uses empty string for content when description is missing or non-ADF', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
      const s = newHubspot();
      await s.createTicket({ key: 'PROJ-3', fields: {} });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.content).toBe('');
    });

    it('handles missing reporter/assignee gracefully', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1' }));
      const s = newHubspot();
      await s.createTicket({ key: 'PROJ-4', fields: { summary: 's' } });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.properties.jira_reporter).toBe('');
      expect(body.properties.jira_assignee).toBe('');
      expect(body.properties.jira_project_key).toBe('');
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(errJson(400, 'invalid'));
      const s = newHubspot();
      await expect(s.createTicket(sampleIssue())).rejects.toThrow(/HubSpot 400/);
    });
  });

  describe('getTicket', () => {
    it('GETs the ticket with requested properties and returns properties', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1', properties: { jira_issue_key: 'PROJ-1', jira_listo_sent: 'true' } }));
      const s = newHubspot();
      const props = await s.getTicket('ticket-1', ['jira_issue_key', 'jira_listo_sent']);
      expect(props).toEqual({ jira_issue_key: 'PROJ-1', jira_listo_sent: 'true' });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tickets/ticket-1?properties=jira_issue_key%2Cjira_listo_sent');
      expect(opts.method).toBe('GET');
    });

    it('returns 404 as a structured error', async () => {
      fetchMock.mockResolvedValueOnce(errJson(404, 'gone'));
      const s = newHubspot();
      await expect(s.getTicket('ticket-gone', [])).rejects.toThrow(/HubSpot 404/);
    });
  });

  describe('updateTicket', () => {
    it('PATCHes the ticket with new properties', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'ticket-1', properties: { jira_listo_sent: 'true' } }));
      const s = newHubspot();
      const res = await s.updateTicket('ticket-1', { jira_listo_sent: 'true' });
      expect(res).toEqual({ id: 'ticket-1', properties: { jira_listo_sent: 'true' } });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tickets/ticket-1');
      expect(opts.method).toBe('PATCH');
      const body = JSON.parse(opts.body);
      expect(body.properties).toEqual({ jira_listo_sent: 'true' });
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(errJson(500, 'x'));
      const s = newHubspot();
      await expect(s.updateTicket('ticket-1', { a: 'b' })).rejects.toThrow(/HubSpot 500/);
    });
  });

  describe('retry integration', () => {
    it('retries on 503 then succeeds (uses default withRetry)', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'down', headers: { get: () => null } })
        .mockResolvedValueOnce(okJson({ total: 0, results: [] }));
      const s = hubspot({ token: 'pat-na1-test', jiraBaseUrl: 'https://org.atlassian.net', pipelineId: 'pipeline-1', newStageId: 'stage-new' });
      const found = await s.findTicketByJiraKey('PROJ-1');
      expect(found).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 400 (default withRetry)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad', headers: { get: () => null } });
      const s = hubspot({ token: 'pat-na1-test', jiraBaseUrl: 'https://org.atlassian.net', pipelineId: 'pipeline-1', newStageId: 'stage-new' });
      await expect(s.findTicketByJiraKey('PROJ-1')).rejects.toThrow(/HubSpot 400/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});