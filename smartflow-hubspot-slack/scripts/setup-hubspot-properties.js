require('dotenv').config();

const PROPERTIES = [
  { name: 'slack_message_ts', label: 'Slack Message TS', type: 'string', fieldType: 'text' },
  { name: 'slack_channel_id', label: 'Slack Channel ID', type: 'string', fieldType: 'text' },
  { name: 'slack_thread_ts', label: 'Slack Thread TS', type: 'string', fieldType: 'text' },
  { name: 'slack_permalink', label: 'Slack Permalink', type: 'string', fieldType: 'text' },
  { name: 'slack_user', label: 'Slack User', type: 'string', fieldType: 'text' },
  {
    name: 'slack_listo_sent',
    label: 'Slack Listo Sent',
    type: 'bool',
    fieldType: 'booleancheckbox',
    options: [
      { label: 'True', value: 'true', displayOrder: 0 },
      { label: 'False', value: 'false', displayOrder: 1 },
    ],
  },
];

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
    console.log(`skip (already exists): ${prop.name}`);
    return;
  }
  if (!res.ok) {
    throw new Error(`HubSpot ${res.status} for ${prop.name}: ${await res.text()}`);
  }
  console.log(`created: ${prop.name}`);
}

async function main() {
  for (const prop of PROPERTIES) {
    await createProperty(prop);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { PROPERTIES, createProperty };
