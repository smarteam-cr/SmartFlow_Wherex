const { withRetry: defaultWithRetry } = require('../utils/retry');

function parseRetryAfterMs(res) {
  if (!res || !res.headers) return null;
  const get = (h) => (typeof res.headers.get === 'function' ? res.headers.get(h) : res.headers[h.toLowerCase()]);
  const value = get('retry-after');
  if (value == null) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function createJiraService({ baseUrl, email, apiToken, withRetry } = {}) {
  if (!baseUrl) throw new Error('JiraService: baseUrl is required');
  if (!email) throw new Error('JiraService: email is required');
  if (!apiToken) throw new Error('JiraService: apiToken is required');
  const withRetryFn = withRetry || defaultWithRetry;

  const cleanBaseUrl = String(baseUrl).replace(/\/$/, '');
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

  const defaultHeaders = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  async function rawFetch(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`JIRA ${res.status}: ${body}`);
      err.status = res.status;
      err.retryAfterMs = parseRetryAfterMs(res);
      err.source = 'jira';
      throw err;
    }
    return res;
  }

  async function request(url, init) {
    const finalInit = {
      ...init,
      headers: { ...defaultHeaders, ...(init?.headers || {}) },
    };
    return withRetryFn(() => rawFetch(url, finalInit), { retries: 3, baseMs: 200 });
  }

  async function requestJson(url, init = {}) {
    const res = await request(url, init);
    return res.json();
  }

  async function searchIssues({ jql, fields = [], maxResults = 100 } = {}) {
    const issues = [];
    let nextPageToken;
    do {
      const data = await requestJson(`${cleanBaseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        body: JSON.stringify({ jql, fields, maxResults, nextPageToken }),
      });
      if (Array.isArray(data.issues)) issues.push(...data.issues);
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);
    return issues;
  }

  async function addComment(issueKey, text) {
    const url = `${cleanBaseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;
    const body = {
      body: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: String(text) }] },
        ],
      },
    };
    const res = await request(url, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function transitionIssue(issueKey, transitionId) {
    const url = `${cleanBaseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
    const res = await request(url, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ transition: { id: String(transitionId) } }),
    });
    return res.json();
  }

  async function respondToIssue(issueKey, { transitionDoneId } = {}) {
    const created = await addComment(
      issueKey,
      `Resuelto via HubSpot el ${new Date().toISOString()}.`
    );
    if (transitionDoneId) {
      await transitionIssue(issueKey, transitionDoneId);
    }
    return created.id;
  }

  return {
    baseUrl: cleanBaseUrl,
    searchIssues,
    addComment,
    transitionIssue,
    respondToIssue,
  };
}

module.exports = createJiraService;
module.exports.createJiraService = createJiraService;
