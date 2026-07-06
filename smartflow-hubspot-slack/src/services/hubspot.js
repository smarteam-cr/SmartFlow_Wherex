const BASE_URL = 'https://api.hubapi.com';

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function createTicket(msg, channel) {
  const body = {
    properties: {
      subject: (msg.text || 'Mensaje de Slack').slice(0, 120),
      content: msg.text,
      hs_pipeline: process.env.HS_PIPELINE_ID,
      hs_pipeline_stage: process.env.HS_STAGE_NEW_ID,
      slack_message_ts: msg.ts,
      slack_channel_id: channel,
      slack_thread_ts: msg.thread_ts || msg.ts,
      slack_user: msg.user || '',
    },
  };
  const res = await fetch(`${BASE_URL}/crm/v3/objects/tickets`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findTicketBySlackTs(ts) {
  const res = await fetch(`${BASE_URL}/crm/v3/objects/tickets/search`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: 'slack_message_ts', operator: 'EQ', value: ts }] },
      ],
      properties: ['hs_object_id', 'slack_message_ts'],
      limit: 1,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.total > 0 ? data.results[0] : null;
}

async function getTicket(ticketId, properties = []) {
  const query = properties.length ? `?properties=${properties.join(',')}` : '';
  const res = await fetch(
    `${BASE_URL}/crm/v3/objects/tickets/${ticketId}${query}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

async function markListoSent(ticketId) {
  const res = await fetch(`${BASE_URL}/crm/v3/objects/tickets/${ticketId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ properties: { slack_listo_sent: 'true' } }),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = { createTicket, findTicketBySlackTs, getTicket, markListoSent };
