const extractDescription = require('./adf');

const SKIP_FIELDS = new Set([
  'description',
  'summary',
  'issuetype',
  'project',
  'status',
  'statusCategory',
  'statuscategorychangedate',
  'created',
  'updated',
  'lastViewed',
  'reporter',
  'assignee',
  'issuelinks',
  'subtasks',
  'attachment',
  'fixVersions',
  'versions',
  'components',
  'labels',
  'watches',
  'votes',
  'workratio',
  'timetracking',
  'aggregatetimeestimate',
  'aggregatetimeoriginalestimate',
  'aggregatetimespent',
  'timeestimate',
  'timeoriginalestimate',
  'timespent',
  'worklog',
  'progress',
  'aggregateprogress',
  'security',
  'development',
]);

function fieldToDisplay(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(fieldToDisplay).filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof value === 'object') {
    if (value.value !== undefined) return fieldToDisplay(value.value);
    if (value.name !== undefined) return fieldToDisplay(value.name);
    return null;
  }
  return null;
}

function buildIssueNote(issue) {
  const fields = issue?.fields || {};
  const names = issue?.names || {};
  const lines = [];

  const description = extractDescription(fields.description);
  if (description) lines.push(`Descripción: ${description}`);

  for (const [key, rawValue] of Object.entries(fields)) {
    if (SKIP_FIELDS.has(key)) continue;
    const display = fieldToDisplay(rawValue);
    if (!display) continue;
    const label = names[key] || key;
    lines.push(`${label}: ${display}`);
  }

  return lines.join('\n');
}

module.exports = buildIssueNote;
module.exports.buildIssueNote = buildIssueNote;
