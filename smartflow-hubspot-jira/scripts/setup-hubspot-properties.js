require('dotenv').config();

const PROPERTIES = [
  { name: 'jira_issue_key', label: 'JIRA Issue Key', type: 'string', fieldType: 'text' },
  { name: 'jira_project_key', label: 'JIRA Project Key', type: 'string', fieldType: 'text' },
  { name: 'jira_url', label: 'JIRA URL', type: 'string', fieldType: 'text' },
  { name: 'jira_reporter', label: 'JIRA Reporter', type: 'string', fieldType: 'text' },
  { name: 'jira_assignee', label: 'JIRA Assignee', type: 'string', fieldType: 'text' },
  { name: 'jira_comment_id', label: 'JIRA Comment ID', type: 'string', fieldType: 'text' },
  {
    name: 'jira_listo_sent',
    label: 'JIRA Listo Sent',
    type: 'bool',
    fieldType: 'booleancheckbox',
    options: [
      { label: 'True', value: 'true', displayOrder: 0 },
      { label: 'False', value: 'false', displayOrder: 1 },
    ],
  },
];

async function diagnoseTickets() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    console.log('HUBSPOT_TOKEN no esta en .env');
    return false;
  }

  console.log('\n--- Diagnostico: que scope necesita Tickets? ---');
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tickets?limit=1', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  if (res.ok) {
    console.log('OK: el token tiene acceso a Tickets (status ' + res.status + ')');
    return true;
  }
  console.log('Status: ' + res.status);
  console.log('Body: ' + body);
  console.log('\nInterpretacion:');
  if (res.status === 401) {
    try {
      const json = JSON.parse(body);
      if (json.message) console.log('  -> ' + json.message);
      if (json.category) console.log('  category: ' + json.category);
    } catch (_) {}
  }
  if (res.status === 403) {
    console.log('  El token existe pero le falta el scope para Tickets.');
    console.log('  En HubSpot: Settings -> Integrations -> Private Apps -> tu app -> Scopes');
    console.log('  Click "Add new scope" y en "Find a scope" busca "tickets".');
  }
  return false;
}

function missingScopesFromError(body) {
  if (!body || !body.errors || !body.errors[0]) return null;
  const ctx = body.errors[0].context || {};
  const scopes = ctx.requiredGranularScopes || [];
  return scopes.length ? scopes : null;
}

async function createProperty(prop) {
  const res = await fetch('https://api.hubapi.com/crm/v3/properties/tickets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...prop, groupName: 'ticketinformation' }),
  });

  if (res.status === 409) {
    console.log(`skip (ya existe): ${prop.name}`);
    return 'skipped';
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HubSpot ${res.status} para ${prop.name}: ${text}`);
    err.responseText = text;
    err.responseStatus = res.status;
    throw err;
  }
  console.log(`creada: ${prop.name}`);
  return 'created';
}

async function setupProperties() {
  let firstError = null;
  for (const prop of PROPERTIES) {
    try {
      await createProperty(prop);
    } catch (err) {
      firstError = err;
      break;
    }
  }
  if (firstError && firstError.responseStatus === 403) {
    let parsed = null;
    try { parsed = JSON.parse(firstError.responseText); } catch (_) {}
    const scopes = missingScopesFromError(parsed);
    if (scopes) {
      console.log('\nAl token le falta uno de estos scopes en la app privada:');
      scopes.forEach((s) => console.log('  - ' + s));
      console.log('\nAgrega el scope en HubSpot -> Settings -> Integrations -> Private Apps -> tu app -> Scopes');
      console.log('y vuelve a correr: node scripts/setup-hubspot-properties.js');
      process.exit(2);
    }
  }
  if (firstError) throw firstError;
}

async function main() {
  const ok = await diagnoseTickets();
  if (!ok) {
    console.log('\nArregla el scope del token y vuelve a correr:');
    console.log('  node scripts/setup-hubspot-properties.js');
    process.exit(1);
  }
  console.log('\n--- Creando propiedades custom en Ticket ---');
  await setupProperties();
  console.log('\nListo. Verifica en HubSpot: Settings -> Properties -> Tickets.');
}

if (require.main === module) {
  main().catch((err) => {
    if (err && err.message) console.error(err.message);
    process.exit(1);
  });
}

module.exports = { PROPERTIES, createProperty, diagnoseTickets, setupProperties };
