require('dotenv').config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

function help() {
  console.log(`
Uso: node bin/list-hubspot-ticket-stages.js

Lista los pipelines de Tickets de tu portal de HubSpot con sus etapas (stages),
para que copies los IDs correctos a .env:
  HUBSPOT_TICKET_PIPELINE_ID     <- id del pipeline que quieras usar
  HUBSPOT_TICKET_STAGE_NEW_ID    <- id de la etapa inicial (al crear el ticket)
  HUBSPOT_TICKET_STAGE_CLOSED_ID <- id de la etapa "cerrado" (dispara el Flujo B)

Configuracion requerida en .env:
  HUBSPOT_TOKEN
`);
}

async function hubspotFetch(path) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot ${res.status}: ${body}`);
  }
  return res.json();
}

function stageClosedHint(stage) {
  const meta = stage.metadata || {};
  if (meta.ticketState) return meta.ticketState === 'CLOSED' ? '  <- cerrado' : '';
  if (typeof meta.isClosed !== 'undefined') return String(meta.isClosed) === 'true' ? '  <- cerrado' : '';
  return '';
}

async function listPipelines() {
  console.log('Pipelines de Tickets disponibles:\n');
  const data = await hubspotFetch('/crm/v3/pipelines/tickets');
  if (!data.results || data.results.length === 0) {
    console.log('  (no hay pipelines de tickets en este portal)');
    return;
  }
  for (const pipeline of data.results) {
    console.log(`Pipeline: ${pipeline.label}  (id=${pipeline.id})`);
    for (const stage of pipeline.stages || []) {
      console.log(`  id=${stage.id.padEnd(6)}  ${stage.label}${stageClosedHint(stage)}`);
    }
    console.log('');
  }
  console.log('Copia el id del pipeline a HUBSPOT_TICKET_PIPELINE_ID.');
  console.log('Copia el id de la primera etapa a HUBSPOT_TICKET_STAGE_NEW_ID.');
  console.log('Copia el id de la etapa marcada "<- cerrado" a HUBSPOT_TICKET_STAGE_CLOSED_ID.');
}

async function main() {
  if (!HUBSPOT_TOKEN) {
    help();
    process.exit(1);
  }
  await listPipelines();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
