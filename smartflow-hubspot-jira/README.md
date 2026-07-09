# smartflow-hubspot-jira

Integracion entre **JIRA Cloud** y **HubSpot CRM**: ingesta periodica de issues a Tasks, y callback de finalizacion (Task completed -> comentario + transicion opcional en JIRA).

Sigue el mismo patron que `../smartflow-hubspot-slack`: monolito Node.js + Express, cron para ingesta, endpoint HTTP para callbacks.

## Arquitectura

```
                 ┌──────── MONOLITO (Node.js) ────────┐
   JIRA  ◀────▶  │  node-cron ──▶ JiraService ──┐     │ ◀────▶ HubSpot
                 │                              ▼     │
                 │                          Dedup    HubSpotService
                 │                              ▲     │      (createTask
                 │                              │     │       getTask
                 │                             Mongo │       updateTask)
                 │                              │     │
                 │  Express /webhooks/hubspot ──┴─────┤
                 │  MongoDB: watermark + log de dedup  │
                 └────────────────────────────────────┘
```

**Flujo A (ingesta):** cada `POLL_INTERVAL_MIN` minutos, `JiraService.searchIssues` lee los issues modificados desde el último watermark y crea una Task en HubSpot por cada issue (sin duplicar, gracias al índice único `(project, issueKey)` en Mongo y al Search API de HubSpot).

**Flujo B (callback):** HubSpot invoca `POST /webhooks/hubspot` cuando una Task se marca como `COMPLETED`. El handler agrega un comentario en JIRA (y opcionalmente transiciona a "Done") e idempotentemente marca la Task con `jira_listo_sent='true'` para evitar duplicados.

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
| `HUBSPOT_TOKEN` | si | — | Token de la app privada de HubSpot (scope `tasks`) |
| `POLL_INTERVAL_MIN` | no | 5 | Minutos entre corridas de ingesta (1–59) |
| `PORT` | no | 3000 | Puerto HTTP |
| `WEBHOOK_SECRET` | si | — | Token compartido que el workflow de HubSpot envia en `X-Webhook-Token` |
| `MONGO_URI` | si | — | URI de MongoDB (ej. `mongodb://localhost:27017/jira_hubspot`) |

## Permisos requeridos

**JIRA (cuenta Atlassian dueña del API Token):**
- Lectura de issues en los proyectos configurados (`Browse Projects`, `View Issues`).
- Escritura de comentarios (`Add Comments`).
- Transicion de issues (`Transition Issues`) si usas `JIRA_TRANSITION_DONE_ID`.

**HubSpot (app privada):**
- Scope para acceder al objeto `tasks`. El nombre exacto del scope depende de la versión de la UI de HubSpot. Si no lo encuentras, corre `npm run setup-hubspot` y el script te dira exactamente cual agregar (el mensaje de error de HubSpot lo nombra).
- `tickets` ya NO se necesita (se reemplazó por Tasks en este flujo).

## Propiedades custom en HubSpot (crear una vez)

**Opcion automatica (recomendada):**

```bash
npm run setup-hubspot
```

Esto:
1. Diagnostica si tu token tiene el scope para Tasks (te dice exactamente cual agregar si falta).
2. Crea las 7 propiedades custom via API.

**Opcion manual** (si prefieres crearlas a mano en la UI):

**Settings → Properties → Tasks → Create property**

| Nombre interno | Label | Tipo | Field type | Group |
|---|---|---|---|---|
| `jira_issue_key` | JIRA Issue Key | Single-line text | text | Task information |
| `jira_project_key` | JIRA Project Key | Single-line text | text | Task information |
| `jira_url` | JIRA URL | Single-line text | text | Task information |
| `jira_reporter` | JIRA Reporter | Single-line text | text | Task information |
| `jira_assignee` | JIRA Assignee | Single-line text | text | Task information |
| `jira_comment_id` | JIRA Comment ID | Single-line text | text | Task information |
| `jira_listo_sent` | JIRA Listo Sent | Booleano (checkbox) | booleancheckbox | Task information |

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

## Configurar el workflow en HubSpot

Para que el callback se dispare al completar una task:

1. En HubSpot, **Automation → Workflows**.
2. Crea un workflow basado en **Tasks**.
3. Trigger: `Task property → hs_task_status is any of COMPLETED`.
4. Accion: **Send a webhook (POST)** a `https://TU-DOMINIO/webhooks/hubspot` con:
   - Header `X-Webhook-Token: <valor de WEBHOOK_SECRET>`.
   - Body: `{ "objectId": "{{task.id}}" }`.

## Endpoints

- `GET /healthz` — healthcheck. 200 `{ok:true,mongo:"up"}` o 503 `{ok:false,mongo:"down"}`.
- `POST /webhooks/hubspot` — callback de HubSpot. Auth via header `X-Webhook-Token`.

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
│   └── hubspot.js         # findTaskByJiraKey, createTask, getTask, updateTask
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
- Hito 3 — Flujo B (webhook con token auth e idempotencia, retry helper)
- Hito 4 — E2E integration + deploy artifacts
