const extractDescription = require('../utils/adf');

function createHubSpotService({ token, jiraBaseUrl = '' } = {}) {
  if (!token) throw new Error('HubSpotService: token is required');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const cleanJiraBaseUrl = String(jiraBaseUrl || '').replace(/\/$/, '');

  async function http(method, path, { body, query } = {}) {
    let url = `https://api.hubapi.com${path}`;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      if (qs) url += `?${qs}`;
    }
    const init = { method, headers: authHeaders };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HubSpot ${res.status}: ${text}`);
    }
    return res.json();
  }

  async function findTaskByJiraKey(issueKey) {
    const data = await http('POST', '/crm/v3/objects/tasks/search', {
      body: {
        filterGroups: [
          { filters: [{ propertyName: 'jira_issue_key', operator: 'EQ', value: issueKey }] },
        ],
        properties: ['hs_object_id', 'jira_issue_key'],
        limit: 1,
      },
    });
    if (!data || data.total === 0 || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    return data.results[0];
  }

  function buildPropertiesFromIssue(issue) {
    const fields = issue.fields || {};
    const summary = (fields.summary || '').trim();
    const subject = summary ? summary.slice(0, 120) : `Issue ${issue.key}`;
    const body = extractDescription(fields.description) || '';
    return {
      hs_task_subject: subject,
      hs_task_body: body,
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: 'MEDIUM',
      jira_issue_key: issue.key,
      jira_project_key: fields.project?.key || '',
      jira_url: cleanJiraBaseUrl ? `${cleanJiraBaseUrl}/browse/${issue.key}` : '',
      jira_reporter: fields.reporter?.displayName || '',
      jira_assignee: fields.assignee?.displayName || '',
    };
  }

  async function createTask(issue) {
    return http('POST', '/crm/v3/objects/tasks', {
      body: { properties: buildPropertiesFromIssue(issue) },
    });
  }

  async function getTask(taskId, properties = []) {
    const data = await http('GET', `/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
      query: properties.length ? { properties: properties.join(',') } : undefined,
    });
    return data.properties || {};
  }

  async function updateTask(taskId, properties) {
    return http('PATCH', `/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
      body: { properties },
    });
  }

  return {
    findTaskByJiraKey,
    createTask,
    getTask,
    updateTask,
  };
}

module.exports = createHubSpotService;
module.exports.createHubSpotService = createHubSpotService;
