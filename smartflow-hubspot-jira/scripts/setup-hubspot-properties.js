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

async function diagnoseTasks() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    console.log('HUBSPOT_TOKEN no esta en .env');
    return false;
  }

  console.log('\n--- Diagnostico: que scope necesita Tasks? ---');
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tasks?limit=1', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  if (res.ok) {
    console.log('OK: el token tiene acceso a Tasks (status ' + res.status + ')');
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
    console.log('  El token existe pero le falta el scope para Tasks.');
    console.log('  En HubSpot: Development -> Legacy apps -> tu app -> Scopes');
    console.log('  Click "Add new scope" y en "Find a scope" busca:');
    console.log('    - "tasks"');
    console.log('    - "crm.objects.tasks"');
    console.log('    - "engagement"');
    console.log('    - "activity"');
    console.log('  Si nada aparece, intenta con el alcance mas amplio "crm" o "crm.import".');
  }
  return false;
}

async function createProperty(prop) {
  const res = await fetch('https://api.hubapi.com/crm/v3/properties/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...prop, groupName: 'taskinformation' }),
  });

  if (res.status === 409) {
    console.log(`skip (ya existe): ${prop.name}`);
    return 'skipped';
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot ${res.status} para ${prop.name}: ${text}`);
  }
  console.log(`creada: ${prop.name}`);
  return 'created';
}

async function setupProperties() {
  for (const prop of PROPERTIES) {
    await createProperty(prop);
  }
}

async function main() {
  const ok = await diagnoseTasks();
  if (!ok) {
    console.log('\nArregla el scope del token y vuelve a correr:');
    console.log('  node scripts/setup-hubspot-properties.js');
    process.exit(1);
  }
  console.log('\n--- Creando propiedades custom en Task ---');
  await setupProperties();
  console.log('\nListo. Verifica en HubSpot: Settings -> Properties -> Tasks.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { PROPERTIES, createProperty, diagnoseTasks, setupProperties };
