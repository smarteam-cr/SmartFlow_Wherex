function createJiraService({ baseUrl, email, apiToken } = {}) {
  if (!baseUrl) throw new Error('JiraService: baseUrl is required');
  if (!email) throw new Error('JiraService: email is required');
  if (!apiToken) throw new Error('JiraService: apiToken is required');

  const cleanBaseUrl = String(baseUrl).replace(/\/$/, '');
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

  const defaultHeaders = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  async function httpJson(url, init = {}) {
    const res = await fetch(url, { ...init, headers: { ...defaultHeaders, ...(init.headers || {}) } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`JIRA ${res.status}: ${body}`);
    }
    return res.json();
  }

  async function searchIssues({ jql, fields = [], maxResults = 100 } = {}) {
    const issues = [];
    let nextPageToken;
    do {
      const data = await httpJson(`${cleanBaseUrl}/rest/api/3/search/jql`, {
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
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`JIRA comment network error: ${err.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA comment ${res.status}: ${text}`);
    }
    return res.json();
  }

  async function transitionIssue(issueKey, transitionId) {
    const url = `${cleanBaseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({ transition: { id: String(transitionId) } }),
      });
    } catch (err) {
      throw new Error(`JIRA transition network error: ${err.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA transition ${res.status}: ${text}`);
    }
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
