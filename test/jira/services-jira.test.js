import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let fetchMock;
let jira;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  delete require.cache[require.resolve('../../src/modules/jira/services/jira')];
  jira = require('../../src/modules/jira/services/jira');
});

const noRetry = (fn) => fn();

function newJira(overrides = {}) {
  return jira({
    baseUrl: overrides.baseUrl ?? 'https://org.atlassian.net',
    email: overrides.email ?? 'svc@example.com',
    apiToken: overrides.apiToken ?? 'token-abc',
    withRetry: overrides.withRetry ?? noRetry,
  });
}

function okJson(data, headers = {}) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null, ...headers } };
}
function errJson(status, body = 'bad') {
  return { ok: false, status, json: async () => ({}), text: async () => body, headers: { get: () => null } };
}

describe('modules/jira/services/jira', () => {
  describe('constructor / auth', () => {
    it('strips a trailing slash from baseUrl', () => {
      const s = newJira({ baseUrl: 'https://org.atlassian.net/' });
      expect(s.baseUrl).toBe('https://org.atlassian.net');
    });

    it('sends Basic auth header with base64(email:token)', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ issues: [] }));
      const s = newJira({ email: 'svc@example.com', apiToken: 'token-abc' });
      await s.searchIssues({ jql: 'project = PROJ' });
      const [, opts] = fetchMock.mock.calls[0];
      const expected = Buffer.from('svc@example.com:token-abc').toString('base64');
      expect(opts.headers.Authorization).toBe(`Basic ${expected}`);
    });
  });

  describe('searchIssues', () => {
    it('POSTs to /rest/api/3/search/jql with jql, fields, maxResults=100', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ issues: [], nextPageToken: null }));
      const s = newJira();
      const issues = await s.searchIssues({
        jql: 'project = PROJ AND updated >= "2026-07-08T00:00:00Z" ORDER BY updated ASC',
        fields: ['summary', 'updated'],
      });
      expect(issues).toEqual([]);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://org.atlassian.net/rest/api/3/search/jql');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.jql).toContain('project = PROJ');
      expect(body.fields).toEqual(['summary', 'updated']);
      expect(body.maxResults).toBe(100);
    });

    it('follows nextPageToken until null and concatenates issues', async () => {
      fetchMock
        .mockResolvedValueOnce(okJson({ issues: [{ key: 'PROJ-1' }], nextPageToken: 'tok-2' }))
        .mockResolvedValueOnce(okJson({ issues: [{ key: 'PROJ-2' }], nextPageToken: 'tok-3' }))
        .mockResolvedValueOnce(okJson({ issues: [{ key: 'PROJ-3' }], nextPageToken: null }));
      const s = newJira();
      const issues = await s.searchIssues({ jql: 'project = PROJ' });
      expect(issues.map((i) => i.key)).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3']);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body2.nextPageToken).toBe('tok-2');
      const body3 = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(body3.nextPageToken).toBe('tok-3');
    });

    it('throws with status and body text on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(errJson(401, 'unauthorized'));
      const s = newJira();
      await expect(s.searchIssues({ jql: 'project = PROJ' })).rejects.toThrow(/JIRA 401: unauthorized/);
    });

    it('tolerates missing issues/nextPageToken fields', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => '{}', headers: { get: () => null } });
      const s = newJira();
      const issues = await s.searchIssues({ jql: 'project = PROJ' });
      expect(issues).toEqual([]);
    });
  });

  describe('getIssue', () => {
    it('GETs /rest/api/3/issue/{key}?expand=names and returns the parsed body', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ key: 'PROJ-1', fields: { summary: 'x' }, names: { summary: 'Summary' } }));
      const s = newJira();
      const data = await s.getIssue('PROJ-1');
      expect(data).toEqual({ key: 'PROJ-1', fields: { summary: 'x' }, names: { summary: 'Summary' } });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://org.atlassian.net/rest/api/3/issue/PROJ-1?expand=names');
      expect(opts.method).toBe('GET');
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(errJson(404, 'not found'));
      const s = newJira();
      await expect(s.getIssue('PROJ-1')).rejects.toThrow(/JIRA 404/);
    });
  });

  describe('addComment', () => {
    it('POSTs ADF doc body to /rest/api/3/issue/{key}/comment', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'comment-99' }));
      const s = newJira();
      const res = await s.addComment('PROJ-1', 'Resuelto');
      expect(res).toEqual({ id: 'comment-99' });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://org.atlassian.net/rest/api/3/issue/PROJ-1/comment');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.body).toEqual({
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Resuelto' }] },
        ],
      });
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(errJson(500, 'oops'));
      const s = newJira();
      await expect(s.addComment('PROJ-1', 'x')).rejects.toThrow(/JIRA 500/);
    });
  });

  describe('transitionIssue', () => {
    it('POSTs to /rest/api/3/issue/{key}/transitions with transition id', async () => {
      fetchMock.mockResolvedValueOnce(okJson({}));
      const s = newJira();
      await s.transitionIssue('PROJ-1', '31');
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://org.atlassian.net/rest/api/3/issue/PROJ-1/transitions');
      expect(JSON.parse(opts.body)).toEqual({ transition: { id: '31' } });
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(errJson(400, 'bad transition'));
      const s = newJira();
      await expect(s.transitionIssue('PROJ-1', '31')).rejects.toThrow(/400/);
    });

    it('does not throw when JIRA responds 204 No Content (real JIRA behavior on success)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => { throw new Error('Unexpected end of JSON input'); },
        text: async () => '',
        headers: { get: () => null },
      });
      const s = newJira();
      await expect(s.transitionIssue('PROJ-1', '31')).resolves.not.toThrow();
    });
  });

  describe('respondToIssue', () => {
    it('adds comment and transitions when transitionDoneId is set', async () => {
      fetchMock
        .mockResolvedValueOnce(okJson({ id: 'comment-99' }))
        .mockResolvedValueOnce(okJson({}));
      const s = newJira();
      const commentId = await s.respondToIssue('PROJ-1', { transitionDoneId: '31' });
      expect(commentId).toBe('comment-99');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain('/issue/PROJ-1/comment');
      expect(fetchMock.mock.calls[1][0]).toContain('/issue/PROJ-1/transitions');
    });

    it('only adds comment when transitionDoneId is undefined', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'comment-99' }));
      const s = newJira();
      const commentId = await s.respondToIssue('PROJ-1', {});
      expect(commentId).toBe('comment-99');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('only adds comment when transitionDoneId is empty string', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ id: 'comment-99' }));
      const s = newJira();
      const commentId = await s.respondToIssue('PROJ-1', { transitionDoneId: '' });
      expect(commentId).toBe('comment-99');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry integration', () => {
    it('retries on 503 then succeeds (uses default withRetry)', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'down', headers: { get: () => null } })
        .mockResolvedValueOnce(okJson({ issues: [] }));
      const s = jira({ baseUrl: 'https://org.atlassian.net', email: 'svc@example.com', apiToken: 'token-abc' });
      const issues = await s.searchIssues({ jql: 'project = PROJ' });
      expect(issues).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 400 (default withRetry)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad', headers: { get: () => null } });
      const s = jira({ baseUrl: 'https://org.atlassian.net', email: 'svc@example.com', apiToken: 'token-abc' });
      await expect(s.searchIssues({ jql: 'project = PROJ' })).rejects.toThrow(/JIRA 400/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});