function toIsoNormalized(isoOrDate) {
  if (!isoOrDate) return null;
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function jqlForProject(project, lowerBoundIso) {
  return `project = ${project} AND updated >= "${lowerBoundIso}" ORDER BY updated ASC`;
}

function createIngestJob({
  jira,
  hubspot,
  mongo,
  projects,
  pollIntervalMin,
  skipSubtasks = false,
  excludeStatuses = [],
} = {}) {
  if (!jira) throw new Error('createIngestJob: jira is required');
  if (!hubspot) throw new Error('createIngestJob: hubspot is required');
  if (!mongo) throw new Error('createIngestJob: mongo is required');
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('createIngestJob: projects must be a non-empty array');
  }
  if (!Number.isInteger(pollIntervalMin) || pollIntervalMin <= 0) {
    throw new Error('createIngestJob: pollIntervalMin must be a positive integer');
  }

  const excludeSet = new Set(excludeStatuses);

  async function run({ now = new Date() } = {}) {
    const previousWatermark = await mongo.getWatermark();
    const lowerBoundIso =
      previousWatermark ||
      new Date(now.getTime() - pollIntervalMin * 60 * 1000).toISOString();

    const result = {
      created: 0,
      skipped: 0,
      errors: [],
      watermark: null,
    };

    let maxUpdated = null;
    let anySucceeded = false;

    for (const project of projects) {
      const jql = jqlForProject(project, lowerBoundIso);
      let issues;
      try {
        issues = await jira.searchIssues({ jql, fields: ['summary', 'description', 'reporter', 'assignee', 'updated', 'status', 'project', 'issuetype'] });
        anySucceeded = true;
      } catch (err) {
        result.errors.push({ project, error: err.message });
        continue;
      }

      for (const iss of issues) {
        const updatedIso = toIsoNormalized(iss?.fields?.updated);
        if (updatedIso && (!maxUpdated || updatedIso > maxUpdated)) {
          maxUpdated = updatedIso;
        }

        if (skipSubtasks && iss?.fields?.issuetype?.name === 'Sub-task') {
          result.skipped += 1;
          continue;
        }

        if (iss?.fields?.status?.name && excludeSet.has(iss.fields.status.name)) {
          result.skipped += 1;
          continue;
        }

        try {
          const existing = await hubspot.findTicketByJiraKey(iss.key);
          if (existing) {
            result.skipped += 1;
            continue;
          }
          const created = await hubspot.createTicket(iss);
          try {
            await mongo.markProcessed(project, iss.key, created.id);
          } catch (dupErr) {
            // Race against a parallel run: another ingest already inserted this issue.
            // Count it as skipped and continue; the duplicate ticket is harmless because of
            // findTicketByJiraKey on subsequent runs.
            result.skipped += 1;
            result.errors.push({ project, issueKey: iss.key, error: `dedup race: ${dupErr.message}` });
            continue;
          }
          result.created += 1;
        } catch (err) {
          result.errors.push({ project, issueKey: iss.key, error: err.message });
        }
      }
    }

    if (anySucceeded) {
      const newWatermark = maxUpdated || new Date(now.getTime()).toISOString();
      await mongo.setWatermark(newWatermark);
      result.watermark = newWatermark;
    }
    return result;
  }

  return { run };
}

module.exports = createIngestJob;
module.exports.createIngestJob = createIngestJob;
