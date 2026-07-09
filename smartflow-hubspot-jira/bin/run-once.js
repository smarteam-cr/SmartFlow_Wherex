require('dotenv').config();

const POLL_INTERVAL_MIN = Number.parseInt(process.env.POLL_INTERVAL_MIN || '5', 10);
const jira = require('../src/services/jira')({
  baseUrl: process.env.JIRA_BASE_URL,
  email: process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN,
});
const hubspot = require('../src/services/hubspot')({
  token: process.env.HUBSPOT_TOKEN,
  jiraBaseUrl: process.env.JIRA_BASE_URL,
  pipelineId: process.env.HUBSPOT_TICKET_PIPELINE_ID,
  newStageId: process.env.HUBSPOT_TICKET_STAGE_NEW_ID,
});
const mongo = require('../src/db/mongo');
const createIngestJob = require('../src/jobs/ingestJira');

async function main() {
  await mongo.connect(process.env.MONGO_URI);
  const projects = (process.env.JIRA_PROJECT_KEY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ingest = createIngestJob({
    jira,
    hubspot,
    mongo,
    projects,
    pollIntervalMin: POLL_INTERVAL_MIN,
  });
  const result = await ingest.run({ now: new Date() });
  console.log(JSON.stringify(result, null, 2));
  await mongo.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
