const express = require('express');

const DEFAULT_HEADER = 'x-webhook-token';

function extractTaskId(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.objectId) return String(body.objectId);
  if (body.taskId) return String(body.taskId);
  if (body.properties && body.properties.hs_object_id) {
    return String(body.properties.hs_object_id);
  }
  return null;
}

function createWebhooksRouter({
  secret,
  headerName = DEFAULT_HEADER,
  jira,
  hubspot,
  transitionDoneId,
} = {}) {
  if (!secret) throw new Error('createWebhooksRouter: secret is required');
  if (!jira) throw new Error('createWebhooksRouter: jira is required');
  if (!hubspot) throw new Error('createWebhooksRouter: hubspot is required');

  const router = express.Router();

  router.post('/', async (req, res) => {
    const provided = req.headers[headerName.toLowerCase()];
    if (!provided || provided !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const taskId = extractTaskId(req.body);
    if (!taskId) {
      return res.status(400).json({ error: 'taskId missing from payload' });
    }

    let taskProps;
    try {
      taskProps = await hubspot.getTask(taskId, [
        'jira_issue_key',
        'jira_comment_id',
        'jira_listo_sent',
        'hs_task_status',
      ]);
    } catch (err) {
      if (err && err.status === 404) {
        return res.status(200).json({ ok: true, skipped: 'gone' });
      }
      // Other HubSpot errors: let HubSpot retry
      console.error('webhook getTask failed:', err);
      return res.status(500).json({ error: 'upstream lookup failed' });
    }

    if (taskProps.hs_task_status !== 'COMPLETED') {
      return res.status(200).json({ ok: true, skipped: 'not_done' });
    }

    if (taskProps.jira_listo_sent === 'true') {
      return res.status(200).json({ ok: true, skipped: 'duplicate' });
    }

    if (!taskProps.jira_issue_key) {
      return res.status(200).json({ ok: true, skipped: 'no_key' });
    }

    let commentId;
    try {
      commentId = await jira.respondToIssue(taskProps.jira_issue_key, {
        transitionDoneId,
      });
    } catch (err) {
      console.error('webhook respondToIssue failed:', err);
      return res.status(500).json({ error: 'jira write failed' });
    }

    try {
      await hubspot.updateTask(taskId, {
        jira_comment_id: commentId,
        jira_listo_sent: 'true',
      });
    } catch (err) {
      console.error('webhook updateTask failed:', err);
      return res.status(500).json({ error: 'task update failed' });
    }

    return res.status(200).json({ ok: true, commentId });
  });

  return router;
}

module.exports = createWebhooksRouter;
module.exports.createWebhooksRouter = createWebhooksRouter;
module.exports.extractTaskId = extractTaskId;
