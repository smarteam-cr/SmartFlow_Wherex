# Integración Slack ⇄ HubSpot — Documentación técnica

**Arquitectura monolítica** · tarea programada de ingesta + API de callback
Stack: Node.js + Express + node-cron + MongoDB

---

## 1. Objetivo

Dos flujos independientes sobre un mismo monolito:

- **Flujo A (Ingesta):** cada *X* minutos (configurable) leer los mensajes nuevos de un canal de Slack y crear un **ticket** en HubSpot por cada mensaje, sin duplicar.
- **Flujo B (Callback):** cuando un ticket se marca como **Completado** en HubSpot, escribir la palabra **"Listo"** como respuesta (en el hilo) del mensaje de Slack que originó el ticket.

---

## 2. Arquitectura general

Un solo proceso Node.js con dos "entradas":

1. Un **scheduler interno** (`node-cron`) que dispara el job de ingesta.
2. Un **servidor HTTP** (Express) que expone el webhook que HubSpot invoca al completar un ticket.

Ambos comparten los mismos servicios (`SlackService`, `HubSpotService`) y una base **MongoDB** que guarda el *watermark* (marca de tiempo del último mensaje procesado) y, opcionalmente, un log de deduplicación.

```
                 ┌──────────────────────── MONOLITO (Node.js) ────────────────────────┐
   Slack  ◀────▶ │  node-cron ──▶ SlackService ──▶ Dedup ──▶ HubSpotService ──▶ tickets│ ◀────▶ HubSpot
                 │  Express /webhooks/hubspot ──▶ HubSpotService + SlackService        │
                 │  MongoDB: watermark + log de dedup                                  │
                 └─────────────────────────────────────────────────────────────────────┘
```

> Todo corre en un solo despliegue (tu VPS Hostinger con Docker sirve perfecto). No hay colas ni microservicios: es intencionalmente simple para el plazo jueves→lunes.

---

## 3. Componentes

| Módulo | Responsabilidad |
|---|---|
| `server.js` | Arranca Express + registra el cron. Punto de entrada. |
| `scheduler.js` | Define el `cron.schedule` con el intervalo configurable e invoca el job de ingesta. |
| `jobs/ingestSlack.js` | Lógica del Flujo A: calcular ventana, leer Slack, deduplicar, crear tickets, mover watermark. |
| `services/slack.js` | Wrapper de `@slack/web-api`: `getMessages(oldest, latest)` y `postListo(channel, threadTs)`. |
| `services/hubspot.js` | Wrapper REST CRM v3: `findTicketBySlackTs()`, `createTicket()`, `getTicket()`. |
| `routes/webhooks.js` | Flujo B: recibe el POST de HubSpot, valida, arma la respuesta a Slack. |
| `db/mongo.js` | Conexión y acceso a `watermark` y `processed_messages`. |
| `config.js` | Carga y valida variables de entorno. |

---

## 4. Flujo A — Ingesta programada (Slack → HubSpot)

### 4.1 Cálculo de la ventana de tiempo

Tu ejemplo: si el intervalo es 5 min y el job corre a la 1:05, debe traer los mensajes de **1:00 → 1:05**.

**Recomendación:** en vez de calcular la ventana como `[ahora - X, ahora]` (frágil: si una corrida falla o se retrasa, se pierden mensajes o se solapan), usa un **watermark persistido**:

- `oldest` = `watermark` (ts del último mensaje procesado; en el primer arranque, `ahora - X`).
- `latest` = `ahora`.
- Al terminar, `watermark` = ts del mensaje más reciente procesado.

Esto cumple tu regla de "los últimos X minutos" en el caso normal, pero **si una corrida se salta, la siguiente recupera el hueco automáticamente** sin perder mensajes. La deduplicación (sección 6) hace que cualquier solape sea inofensivo.

> Slack usa timestamps tipo `"1719950700.123456"` (segundos Unix con microsegundos). Trabaja siempre con el `ts` del mensaje, no con la hora local.

### 4.2 Leer mensajes de Slack

```js
// services/slack.js
const { WebClient } = require('@slack/web-api');
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

async function getMessages(channel, oldest, latest) {
  const messages = [];
  let cursor;
  do {
    const res = await slack.conversations.history({
      channel,
      oldest,            // "1719950400.000000"
      latest,            // "1719950700.000000"
      inclusive: false,  // evita re-tomar el borde de la ventana anterior
      limit: 200,
      cursor,
    });
    messages.push(...res.messages);
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);
  return messages;
}
```

- Ignorar mensajes de bots / del propio bot (`msg.bot_id`, `msg.subtype === 'bot_message'`) y submensajes de sistema (joins, etc.) según convenga.
- Para responder en el hilo (Flujo B), guarda `msg.thread_ts || msg.ts` como `slack_thread_ts`.

### 4.3 Deduplicar y crear el ticket

Por cada mensaje nuevo:

1. Buscar si ya existe un ticket con esa `slack_message_ts` (sección 6).
2. Si no existe → crear el ticket con las propiedades Slack.

```js
// services/hubspot.js
async function createTicket(msg, channel) {
  const body = {
    properties: {
      subject: msg.text.slice(0, 120) || 'Mensaje de Slack',
      content: msg.text,
      hs_pipeline: process.env.HS_PIPELINE_ID,
      hs_pipeline_stage: process.env.HS_STAGE_NEW_ID,
      slack_message_ts: msg.ts,
      slack_channel_id: channel,
      slack_thread_ts: msg.thread_ts || msg.ts,
      slack_user: msg.user || '',
    },
  };
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tickets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}
```

3. Al terminar el lote, actualizar el `watermark` con el `ts` máximo procesado.

---

## 5. Flujo B — Callback de finalización (HubSpot → Slack)

### 5.1 Disparo desde HubSpot

Dos opciones para detectar "ticket completado":

- **(Recomendada, más simple) Workflow con acción Webhook:** crear un workflow basado en tickets con criterio *"Ticket status / etapa = Completado"* y acción **Send a webhook (POST)** hacia `https://TU-DOMINIO/webhooks/hubspot`. HubSpot envía el `objectId` del ticket.
- **Webhook Subscriptions de la app privada:** suscribirse a `ticket.propertyChange` sobre `hs_pipeline_stage` y filtrar en tu código por el stage de completado. Más control, un poco más de código.

### 5.2 Endpoint de la API

`POST /webhooks/hubspot`

**Pasos del handler:**

1. **Validar el origen.** Si usas Webhook Subscriptions, verifica la firma `X-HubSpot-Signature-v3` con tu `WEBHOOK_SECRET`. Si usas la acción de workflow, protege con un token secreto en la URL/header.
2. Obtener el `ticketId` del payload.
3. `GET /crm/v3/objects/tickets/{ticketId}?properties=slack_channel_id,slack_thread_ts,hs_pipeline_stage`.
4. (Si vino por subscription) confirmar que el stage es el de completado.
5. Postear en Slack:

```js
await slack.chat.postMessage({
  channel: ticket.properties.slack_channel_id,
  thread_ts: ticket.properties.slack_thread_ts, // responde en el hilo del mensaje original
  text: 'Listo',
});
```

6. Responder `200 OK` **rápido** (HubSpot reintenta si tarda demasiado o falla). Si el trabajo pesado pudiera demorar, responde 200 y procesa aparte; aquí es tan liviano que no hace falta.

**Idempotencia:** opcionalmente marca el ticket (`slack_listo_sent = true`) o registra el `ticketId` para no postear "Listo" dos veces si HubSpot reintenta.

---

## 6. Deduplicación

**Clave de dedup:** `slack_message_ts` (el `ts` de Slack es único por canal). Combinado con `slack_channel_id` es único a nivel global.

**Antes de crear cada ticket**, consulta el Search API de HubSpot:

```js
async function findTicketBySlackTs(ts) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tickets/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{ filters: [
        { propertyName: 'slack_message_ts', operator: 'EQ', value: ts },
      ]}],
      properties: ['hs_object_id', 'slack_message_ts'],
      limit: 1,
    }),
  });
  const data = await res.json();
  return data.total > 0 ? data.results[0] : null;
}
```

**Doble red (recomendado):** además guarda cada `ts` procesado en la colección `processed_messages` de Mongo con índice único. Así evitas dobles inserciones aunque el Search API tenga latencia de indexación (el Search de HubSpot no es instantáneo tras crear un objeto). El índice único de Mongo es tu garantía dura contra duplicados dentro de una misma corrida y entre corridas solapadas.

```js
// índice único
db.collection('processed_messages').createIndex(
  { channel: 1, ts: 1 }, { unique: true }
);
```

---

## 7. Propiedades a crear en HubSpot (objeto Ticket)

Créalas una vez vía UI (Settings → Properties → Tickets) o por API (`POST /crm/v3/properties/tickets`).

| Nombre interno | Tipo | Uso |
|---|---|---|
| `slack_message_ts` | Single-line text | **Clave de deduplicación** (ts único del mensaje) |
| `slack_channel_id` | Single-line text | Canal de origen (para responder) |
| `slack_thread_ts` | Single-line text | Hilo donde se escribe "Listo" |
| `slack_permalink` | Single-line text | Enlace al mensaje (opcional, trazabilidad) |
| `slack_user` | Single-line text | Autor del mensaje (opcional) |
| `slack_listo_sent` | Booleano (opcional) | Idempotencia del Flujo B |

Ejemplo de creación por API:

```json
POST /crm/v3/properties/tickets
{
  "name": "slack_message_ts",
  "label": "Slack Message TS",
  "type": "string",
  "fieldType": "text",
  "groupName": "ticketinformation"
}
```

---

## 8. Configuración (variables de entorno)

```dotenv
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C0XXXXXXX

# HubSpot (private app)
HUBSPOT_TOKEN=pat-na1-...
HS_PIPELINE_ID=0
HS_STAGE_NEW_ID=1
HS_STAGE_COMPLETED_ID=4

# Scheduler
POLL_INTERVAL_MIN=5

# API
PORT=3000
WEBHOOK_SECRET=cadena-larga-secreta

# Mongo (compartida con smartflow-hubspot-jira: base WherEXdb)
MONGO_URI=mongodb://localhost:27017/WherEXdb
```

**Scopes de Slack (Bot Token):** `channels:history` (canal público) o `groups:history` (privado), `chat:write`, y `channels:read`/`groups:read` para resolver el canal. Invita al bot al canal.

**Scopes de HubSpot (app privada):** `tickets` (read/write) y `crm.objects.tickets.read/write`.

---

## 9. Modelo de datos en MongoDB

```
watermark            { _id: "slack_ingest", ts: "1719950700.123456", updatedAt }
processed_messages   { channel, ts, ticketId, createdAt }   // índice único (channel, ts)
```

`watermark` es un único documento que avanza en cada corrida. `processed_messages` es la red de seguridad de dedup y sirve de auditoría (qué mensaje generó qué ticket).

---

## 10. Casos borde y manejo de errores

- **Corrida fallida / VPS reiniciado:** al usar watermark persistido, la siguiente corrida recupera el rango pendiente. No pierdes mensajes.
- **Solape de ventanas:** inofensivo gracias a la dedup por `ts` + índice único.
- **Rate limits:** Slack (`Tier 3`, ~50 req/min en `conversations.history`) y HubSpot (Search API tiene límites propios más estrictos). Con paginado y lotes pequeños vas sobrado; añade *retry* con backoff en 429.
- **Latencia de indexado del Search de HubSpot:** por eso la doble red con Mongo.
- **Reintentos de HubSpot en el webhook:** responde 200 rápido y hazlo idempotente (`slack_listo_sent`).
- **Mensajes editados / hilos:** decide si ignoras `subtype: "message_changed"`; para MVP, procesa solo mensajes top-level nuevos.
- **Mensaje sin texto (solo archivo):** usa un subject por defecto.

---

## 11. Estructura de proyecto sugerida

```
src/
  server.js            # Express + arranque del cron
  config.js
  scheduler.js
  jobs/
    ingestSlack.js     # Flujo A
  routes/
    webhooks.js        # Flujo B (POST /webhooks/hubspot)
  services/
    slack.js
    hubspot.js
  db/
    mongo.js
.env
Dockerfile
```

Cron con node-cron:

```js
// scheduler.js
const cron = require('node-cron');
const { ingest } = require('./jobs/ingestSlack');
const min = process.env.POLL_INTERVAL_MIN || 5;
cron.schedule(`*/${min} * * * *`, () => ingest().catch(console.error));
```

---

## 12. Plan de implementación (jueves → lunes)

| Día | Entregable |
|---|---|
| **Jue** | Crear las propiedades en HubSpot. App privada de HubSpot + Bot de Slack con scopes. Repo base (Express + config + Mongo + healthcheck). |
| **Vie** | Flujo A completo: `SlackService.getMessages`, cálculo de ventana con watermark, `HubSpotService.createTicket`, dedup (Search + índice Mongo). Probar end-to-end con mensajes reales. |
| **Sáb/Dom** | Flujo B: endpoint `/webhooks/hubspot`, `getTicket`, `postMessage("Listo")` en hilo, idempotencia. Configurar el workflow de HubSpot con la acción webhook. |
| **Lun** | Pruebas end-to-end de ambos flujos, manejo de 429/errores, deploy en el VPS (Docker), y validar dedup con casos solapados. |

---

*Documento base para el MVP. Ajusta stages/pipeline IDs a tu portal de HubSpot antes de desplegar.*
