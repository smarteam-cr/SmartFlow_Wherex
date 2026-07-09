# smartflow-hubspot-jira

Integracion entre **JIRA Cloud** y **HubSpot CRM**: ingesta periodica de issues a Tickets, y callback de finalizacion (Ticket movido a la etapa cerrada -> comentario + transicion opcional en JIRA).

Sigue el mismo patron que `../smartflow-hubspot-slack`: monolito Node.js + Express, cron para ingesta, endpoint HTTP para callbacks.

## Arquitectura

```
                 ┌──────── MONOLITO (Node.js) ────────┐
   JIRA  ◀────▶  │  node-cron ──▶ JiraService ──┐     │ ◀────▶ HubSpot
                 │                              ▼     │
                 │                          Dedup    HubSpotService
                 │                              ▲     │      (createTicket
                 │                              │     │       getTicket
                 │                             Mongo │       updateTicket)
                 │                              │     │
                 │  Express /webhooks/hubspot ──┴─────┤
                 │  MongoDB: watermark + log de dedup  │
                 └────────────────────────────────────┘
```

**Flujo A (ingesta):** cada `POLL_INTERVAL_MIN` minutos, `JiraService.searchIssues` lee los issues modificados desde el último watermark y crea un Ticket en HubSpot por cada issue (sin duplicar, gracias al índice único `(project, issueKey)` en Mongo y al Search API de HubSpot).

**Flujo B (callback):** HubSpot invoca `POST /webhooks/hubspot` cuando un Ticket se mueve a la etapa `HUBSPOT_TICKET_STAGE_CLOSED_ID`. El handler agrega un comentario en JIRA (y opcionalmente transiciona a "Done") e idempotentemente marca el Ticket con `jira_listo_sent='true'` para evitar duplicados.

## Stack

- Node.js 20 + Express 4
- node-cron (ingesta cada N min)
- MongoDB (watermark + dedup)
- Vitest (unit + integration con `mongodb-memory-server` + `supertest`)

## Configuracion (variables de entorno)

Copia `.env.example` a `.env` y completa los valores.

| Variable | Obligatorio | Default | Descripcion |
|---|---|---|---|
| `JIRA_BASE_URL` | si | — | `https://tu-org.atlassian.net` (sin slash final) |
| `JIRA_EMAIL` | si | — | Cuenta Atlassian dueña del API token |
| `JIRA_API_TOKEN` | si | — | Token de https://id.atlassian.com/manage-profile/security/api-tokens |
| `JIRA_PROJECT_KEY` | si | — | Uno o varios proyectos separados por coma (ej. `PROJ,AUX`) |
| `JIRA_TRANSITION_DONE_ID` | no | — | ID de la transicion a "Done" para el Flujo B. Si esta vacio, el Flujo B solo agrega comentario |
| `HUBSPOT_TOKEN` | si | — | Token de la app privada de HubSpot (scope `tickets`) |
| `HUBSPOT_APP_SECRET` | si | — | Client secret de la app privada (pestaña Auth → "Show secret"), usado para verificar la firma HMAC del webhook |
| `HUBSPOT_TICKET_PIPELINE_ID` | si | — | Pipeline de Tickets donde se crean los registros (`npm run list-hubspot-ticket-stages`) |
| `HUBSPOT_TICKET_STAGE_NEW_ID` | si | — | Etapa inicial al crear un ticket |
| `HUBSPOT_TICKET_STAGE_CLOSED_ID` | si | — | Etapa que dispara el Flujo B (callback a JIRA) |
| `POLL_INTERVAL_MIN` | no | 5 | Minutos entre corridas de ingesta (1–59) |
| `PORT` | no | 3000 | Puerto HTTP |
| `MONGO_URI` | si | — | URI de MongoDB (ej. `mongodb://localhost:27017/jira_hubspot`) |

## Permisos requeridos

**JIRA (cuenta Atlassian dueña del API Token):**
- Lectura de issues en los proyectos configurados (`Browse Projects`, `View Issues`).
- Escritura de comentarios (`Add Comments`).
- Transicion de issues (`Transition Issues`) si usas `JIRA_TRANSITION_DONE_ID`.

**HubSpot (app privada):**
- Scope para acceder al objeto `tickets` (lectura, escritura y schema write para las propiedades custom). Si no lo encuentras, corre `npm run setup-hubspot` y el script te dira exactamente cual agregar (el mensaje de error de HubSpot lo nombra).
- `tasks` ya NO se necesita (se reemplazó por Tickets en este flujo, porque las propiedades custom de Tasks solo estan disponibles en una Beta publica a la que no todas las cuentas tienen acceso).

## Propiedades custom en HubSpot (crear una vez)

**Opcion automatica (recomendada):**

```bash
npm run setup-hubspot
```

Esto:
1. Diagnostica si tu token tiene el scope para Tickets (te dice exactamente cual agregar si falta).
2. Crea las 7 propiedades custom via API.

**Opcion manual** (si prefieres crearlas a mano en la UI):

**Settings → Properties → Tickets → Create property**

| Nombre interno | Label | Tipo | Field type | Group |
|---|---|---|---|---|
| `jira_issue_key` | JIRA Issue Key | Single-line text | text | Ticket information |
| `jira_project_key` | JIRA Project Key | Single-line text | text | Ticket information |
| `jira_url` | JIRA URL | Single-line text | text | Ticket information |
| `jira_reporter` | JIRA Reporter | Single-line text | text | Ticket information |
| `jira_assignee` | JIRA Assignee | Single-line text | text | Ticket information |
| `jira_comment_id` | JIRA Comment ID | Single-line text | text | Ticket information |
| `jira_listo_sent` | JIRA Listo Sent | Booleano (checkbox) | booleancheckbox | Ticket information |

## Arranque local

```bash
npm install
npm start
```

Esto arranca:
1. Conexion a MongoDB
2. Scheduler con `node-cron` para ingesta cada `POLL_INTERVAL_MIN` minutos
3. Express escuchando en `PORT` con:
   - `GET /healthz` (200 si Mongo responde, 503 si no)
   - `POST /webhooks/hubspot` (endpoint del callback de HubSpot)

### Scripts utiles durante el setup

| Comando | Para que |
|---|---|
| `npm run setup-hubspot` | Diagnostica scopes de HubSpot y crea las 7 propiedades custom via API |
| `npm run list-hubspot-ticket-stages` | Lista los pipelines/etapas de Tickets (necesario para `HUBSPOT_TICKET_PIPELINE_ID`, `HUBSPOT_TICKET_STAGE_NEW_ID`, `HUBSPOT_TICKET_STAGE_CLOSED_ID`) |
| `npm run list-jira-transitions` | Lista las transiciones disponibles (necesario para encontrar `JIRA_TRANSITION_DONE_ID`) |
| `npm run list-jira-transitions PROJ-123` | Lista transiciones de un issue especifico |
| `npm run run-once` | Ejecuta UNA corrida de ingesta sin esperar el cron (util para probar) |

## Tests

```bash
npm test                # una corrida (suite completa: 128 tests)
npm run test:watch      # watch
npm run test:coverage   # reporte de cobertura
```

Suites:
- `config` · `mongo` · `jira` · `adf` · `hubspot` · `ingestJira` · `scheduler` · `retry` · `server` · `webhooks` · `e2e`

## Deploy con Docker

```bash
cp .env.example .env  # editar valores
docker compose up -d
```

`docker-compose.yml` levanta:
- `app` — el monolito (Node 20 alpine) en el puerto 3000
- `mongo` — MongoDB 7 con volumen persistente

`Dockerfile` incluye un `HEALTHCHECK` contra `GET /healthz` que Docker respeta para reportar el estado del contenedor.

## Configurar el webhook en HubSpot

El Flujo B usa la suscripción nativa de Webhooks de la app privada (no un Workflow custom): HubSpot firma cada request con HMAC usando el Client secret de la app, así que no hay ningún token que compartir manualmente.

1. En HubSpot, ve a tu app privada: **Development → Legacy apps → tu app**.
2. Pestaña **Webhooks** → "Edit webhooks" → Target URL = `https://TU-DOMINIO/webhooks/hubspot`.
3. "Create subscription" → objeto **Tickets**, evento **Property changed**, propiedad `hs_pipeline_stage` → Subscribe → Commit changes.
4. Copia el Client secret desde la pestaña **Auth** ("Show secret") a `HUBSPOT_APP_SECRET` en `.env`.

En local, expón tu servidor con `ngrok http 3000` y usa la URL que te da ngrok como Target URL. En producción, un reverse proxy (nginx) hacia el puerto de la app sirve igual — mismo patrón que `../smartflow-hubspot-slack`.

## Endpoints

- `GET /healthz` — healthcheck. 200 `{ok:true,mongo:"up"}` o 503 `{ok:false,mongo:"down"}`.
- `POST /webhooks/hubspot` — suscripción de webhooks de HubSpot (`ticket.propertyChange`). Requiere firma válida (`x-hubspot-signature` o `x-hubspot-signature-v3`) y body como array de eventos.

## Estructura del proyecto

```
src/
├── server.js              # Express + arranque del cron + graceful shutdown
├── config.js              # carga y valida env vars
├── scheduler.js           # node-cron con DI
├── db/
│   └── mongo.js           # connect, watermark, processed_issues, ping
├── services/
│   ├── jira.js            # searchIssues, addComment, transitionIssue, respondToIssue
│   └── hubspot.js         # findTicketByJiraKey, createTicket, getTicket, updateTicket
├── jobs/
│   └── ingestJira.js      # orquestacion de la ingesta (Flujo A)
├── routes/
│   ├── health.js          # GET /healthz
│   └── webhooks.js        # POST /webhooks/hubspot (Flujo B)
└── utils/
    ├── adf.js             # ADF (Atlassian Document Format) → texto plano
    └── retry.js           # withRetry con backoff exponencial y Retry-After
```

## Estado

MVP completo. 4 hitos cerrados:
- Hito 1 — bootstrap, Mongo, healthcheck
- Hito 2 — Flujo A (JiraService, ADF, HubSpotService, ingest job, scheduler)
- Hito 3 — Flujo B (webhook con firma HMAC e idempotencia, retry helper)
- Hito 4 — E2E integration + deploy artifacts
