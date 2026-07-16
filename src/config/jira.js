// Default: IDs de custom field donde Jira Forms sincroniza "Tipo de Asistencia" (uno por
// linea de producto). Hardcodeados aca (y no solo en .env) para que el filtro CC quede
// activo por defecto — un deploy que trae el codigo nuevo pero no actualiza el .env del
// servidor (.env esta en .gitignore, git pull no lo toca) no debe dejar el filtro apagado.
const DEFAULT_ASSISTANCE_TYPE_FIELD_IDS = [
  'customfield_10822', // Tipo de Asistencia / Sourcing
  'customfield_10823', // Tipo de Asistencia / DataOps
  'customfield_10824', // Tipo de Asistencia / FyC
  'customfield_10825', // Tipo de Asistencia / Pay
];

function loadJiraConfig(env = process.env, { sharedPollIntervalMin } = {}) {
  const errors = [];

  function req(name) {
    const v = env[name];
    if (!v || String(v).trim() === '') {
      errors.push(`Missing required env var: ${name}`);
    }
    return v;
  }

  const baseUrl = req('JIRA_BASE_URL');
  const email = req('JIRA_EMAIL');
  const apiToken = req('JIRA_API_TOKEN');
  const projectKey = req('JIRA_PROJECT_KEY');
  const hubspotToken = req('JIRA_HUBSPOT_TOKEN');
  const hubspotAppSecret = req('JIRA_HUBSPOT_APP_SECRET');
  const hubspotPipelineId = req('JIRA_HUBSPOT_PIPELINE_ID');
  const hubspotStageNewId = req('JIRA_HUBSPOT_STAGE_NEW_ID');
  const hubspotStageClosedId = req('JIRA_HUBSPOT_STAGE_CLOSED_ID');

  let pollIntervalMin;
  if (sharedPollIntervalMin !== undefined) {
    pollIntervalMin = sharedPollIntervalMin;
  } else if (env.POLL_INTERVAL_MIN) {
    const n = Number.parseInt(env.POLL_INTERVAL_MIN, 10);
    pollIntervalMin = Number.isInteger(n) && n > 0 ? n : 5;
  } else {
    pollIntervalMin = 5;
  }
  if (env.JIRA_POLL_INTERVAL_MIN) {
    const n = Number.parseInt(env.JIRA_POLL_INTERVAL_MIN, 10);
    if (Number.isInteger(n) && n > 0) {
      pollIntervalMin = n;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const cleanBaseUrl = String(baseUrl).replace(/\/$/, '');
  const projectKeys = String(projectKey)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const assistanceTypeFieldIds = env.JIRA_ASSISTANCE_TYPE_FIELD_IDS
    ? String(env.JIRA_ASSISTANCE_TYPE_FIELD_IDS)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_ASSISTANCE_TYPE_FIELD_IDS;

  return {
    ok: true,
    errors: [],
    values: {
      JIRA_BASE_URL: cleanBaseUrl,
      JIRA_EMAIL: email,
      JIRA_API_TOKEN: apiToken,
      JIRA_PROJECT_KEYS: projectKeys,
      JIRA_ASSISTANCE_TYPE_FIELD_IDS: assistanceTypeFieldIds,
      JIRA_TRANSITION_DONE_ID: env.JIRA_TRANSITION_DONE_ID
        ? String(env.JIRA_TRANSITION_DONE_ID)
        : undefined,
      JIRA_HUBSPOT_TOKEN: hubspotToken,
      JIRA_HUBSPOT_APP_SECRET: hubspotAppSecret,
      JIRA_HUBSPOT_PIPELINE_ID: hubspotPipelineId,
      JIRA_HUBSPOT_STAGE_NEW_ID: hubspotStageNewId,
      JIRA_HUBSPOT_STAGE_CLOSED_ID: hubspotStageClosedId,
      POLL_INTERVAL_MIN: pollIntervalMin,
    },
  };
}

module.exports = { loadJiraConfig };