/**
 * Script de diagnóstico: busca un issue de Jira (por key, o el último actualizado
 * del proyecto configurado) y reporta si ya tiene ticket en HubSpot o si sería
 * creado en la próxima corrida del job de ingesta.
 *
 * Uso:
 *   node scripts/check-jira-issue.js            -> revisa el último issue actualizado
 *   node scripts/check-jira-issue.js P30-12136   -> revisa un issue específico
 */
require('dotenv').config();

const { loadConfig } = require('../src/config');
const createJiraService = require('../src/modules/jira/services/jira');
const createJiraHubSpotService = require('../src/modules/jira/services/hubspot');

async function main() {
  const issueKeyArg = process.argv[2];

  const cfg = loadConfig(process.env);
  if (!cfg.jira.ok) {
    console.error('Config de Jira inválida:', cfg.jira.errors.join('; '));
    process.exit(1);
  }
  const { JIRA_PROJECT_KEYS, JIRA_HUBSPOT_STAGE_NEW_ID, POLL_INTERVAL_MIN } = cfg.jira.values;

  const jira = createJiraService({
    baseUrl: cfg.jira.values.JIRA_BASE_URL,
    email: cfg.jira.values.JIRA_EMAIL,
    apiToken: cfg.jira.values.JIRA_API_TOKEN,
  });
  const hubspot = createJiraHubSpotService({
    token: cfg.jira.values.JIRA_HUBSPOT_TOKEN,
    jiraBaseUrl: cfg.jira.values.JIRA_BASE_URL,
    pipelineId: cfg.jira.values.JIRA_HUBSPOT_PIPELINE_ID,
    newStageId: cfg.jira.values.JIRA_HUBSPOT_STAGE_NEW_ID,
  });

  const fields = ['summary', 'status', 'updated', 'project', 'issuetype'];

  let issue;
  if (issueKeyArg) {
    const jql = `key = ${issueKeyArg}`;
    const issues = await jira.searchIssues({ jql, fields, maxResults: 1 });
    issue = issues[0];
    if (!issue) {
      console.error(`No se encontró el issue "${issueKeyArg}" en Jira.`);
      process.exit(1);
    }
  } else {
    const project = JIRA_PROJECT_KEYS[0];
    const jql = `project = ${project} ORDER BY updated DESC`;
    const issues = await jira.searchIssues({ jql, fields, maxResults: 1 });
    issue = issues[0];
    if (!issue) {
      console.error(`No se encontraron issues en el proyecto "${project}".`);
      process.exit(1);
    }
  }

  console.log(`\nIssue: ${issue.key} - ${issue.fields.summary}`);
  console.log(`Estado: ${issue.fields.status?.name}`);
  console.log(`Actualizado: ${issue.fields.updated}`);

  const existing = await hubspot.findTicketByJiraKey(issue.key);
  if (existing) {
    console.log(`\n✔ Ya existe un ticket en HubSpot para este issue (id: ${existing.id}).`);
  } else {
    console.log(`\n✘ Aún no existe ticket en HubSpot para este issue.`);
    console.log(
      `  El job de ingesta corre cada ${POLL_INTERVAL_MIN} min y crearía el ticket ` +
        `en el stage "${JIRA_HUBSPOT_STAGE_NEW_ID}" si "updated" cae dentro de la ventana de polling.`
    );
  }
}

main().catch((err) => {
  console.error('Error ejecutando el script:', err);
  process.exit(1);
});
