require('dotenv').config();

const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY;

function help() {
  console.log(`
Uso: node bin/list-jira-transitions.js [ISSUE_KEY]

Sin ISSUE_KEY: lista transiciones del proyecto ${JIRA_PROJECT_KEY || '(no configurado)'}.
Con ISSUE_KEY (ej. PROJ-123): lista transiciones de ese issue especifico.

Configuracion requerida en .env:
  JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
`);
}

async function jiraFetch(path, init = {}) {
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  const res = await fetch(`${JIRA_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JIRA ${res.status}: ${body}`);
  }
  return res.json();
}

async function listFromIssue(issueKey) {
  console.log(`Transiciones disponibles en ${issueKey}:\n`);
  const data = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
  if (!data.transitions || data.transitions.length === 0) {
    console.log('  (ninguna visible para tu cuenta — necesitas permiso "Transition Issues")');
    return;
  }
  for (const t of data.transitions) {
    const to = t.to?.name || '(sin nombre)';
    console.log(`  id=${t.id.padEnd(6)}  ${t.name.padEnd(30)}  -> ${to}`);
  }
  console.log('\nCopia el "id" de la fila "Done" / "Cerrar" / "Resolver" a JIRA_TRANSITION_DONE_ID en .env');
}

async function listFromProject() {
  if (!JIRA_PROJECT_KEY) {
    help();
    process.exit(1);
  }
  const jql = `project = ${JIRA_PROJECT_KEY} ORDER BY created DESC`;
  console.log(`Buscando el primer issue del proyecto ${JIRA_PROJECT_KEY}...\n`);
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: ['summary'], maxResults: 1 }),
  });
  if (!data.issues || data.issues.length === 0) {
    console.log(`El proyecto ${JIRA_PROJECT_KEY} no tiene issues. Crea uno y reintenta.`);
    return;
  }
  const issueKey = data.issues[0].key;
  console.log(`Usando issue de muestra: ${issueKey} (${data.issues[0].fields?.summary || ''})\n`);
  await listFromIssue(issueKey);
}

async function main() {
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    help();
    process.exit(1);
  }
  const arg = process.argv[2];
  if (arg) {
    await listFromIssue(arg);
  } else {
    await listFromProject();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
