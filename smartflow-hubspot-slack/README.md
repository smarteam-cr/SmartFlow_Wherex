# smartflow-hubspot-slack

Integración entre **Slack** y **HubSpot**: ingesta mensajes de un canal como tickets, y cuando el ticket se marca como completado en HubSpot, responde "Listo" en el hilo de Slack que lo originó.

Monolito en Node.js + Express, con un cron interno (`node-cron`) para la ingesta y un endpoint HTTP para el callback de HubSpot. Persistencia en MongoDB (watermark de ingesta + registro de mensajes procesados).

Para el detalle de diseño (flujos, modelo de datos, casos borde) ver [`documentacion-slack-hubspot.md`](./documentacion-slack-hubspot.md) y el diagrama [`arquitectura-slack-hubspot.svg`](./arquitectura-slack-hubspot.svg).

## Cómo funciona

- **Flujo A — Ingesta (Slack → HubSpot):** cada `POLL_INTERVAL_MIN` minutos, `src/scheduler.js` dispara `src/jobs/ingestSlack.js`, que lee mensajes nuevos del canal configurado, evita duplicados y crea un ticket en HubSpot por cada mensaje.
- **Flujo B — Callback (HubSpot → Slack):** `POST /webhooks/hubspot` (`src/routes/webhooks.js`) recibe la webhook subscription de la private app de HubSpot (evento `ticket.propertyChange` sobre `hs_pipeline_stage`), filtra los que llegan a la etapa `HS_STAGE_COMPLETED_ID`, busca el canal/hilo de Slack asociado y postea "Listo" en el hilo. Es idempotente vía la propiedad `slack_listo_sent`.

## Estructura

```
src/
  server.js            Arranque de Express + cron
  config.js             Carga y valida variables de entorno
  scheduler.js           Cron de ingesta (node-cron)
  jobs/ingestSlack.js    Flujo A
  routes/webhooks.js     Flujo B (POST /webhooks/hubspot)
  services/slack.js      Wrapper de @slack/web-api
  services/hubspot.js    Wrapper de la API REST de HubSpot
  db/mongo.js            Conexión y colecciones de Mongo
scripts/
  setup-hubspot-properties.js   Crea las propiedades custom en el objeto Ticket de HubSpot
test/                    Tests con Vitest (mongodb-memory-server + supertest)
```

## Requisitos

- Node.js 20+
- Docker (para MongoDB local) o una instancia de MongoDB accesible
- Un Bot Token de Slack y un token de app privada de HubSpot (ver [Configuración](#configuración))

## Configuración

Copia `.env.example` a `.env` y completa los valores:

```dotenv
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C0XXXXXXX

# HubSpot (private app)
HUBSPOT_TOKEN=pat-na1-...
HUBSPOT_APP_SECRET=...
HS_PIPELINE_ID=0
HS_STAGE_NEW_ID=1
HS_STAGE_COMPLETED_ID=4

# Scheduler
POLL_INTERVAL_MIN=5

# API
PORT=3000

# Mongo
MONGO_URI=mongodb://localhost:27017/slack_hubspot
```

- **Slack:** el bot necesita los scopes `channels:history` (o `groups:history` si el canal es privado), `chat:write`, y debe estar invitado al canal.
- **HubSpot:** la app privada necesita permisos de lectura/escritura sobre `tickets` (`crm.objects.tickets.read/write`).
- **Propiedades del ticket:** antes del primer uso, crea las propiedades custom (`slack_message_ts`, `slack_channel_id`, `slack_thread_ts`, `slack_permalink`, `slack_user`, `slack_listo_sent`) corriendo:

  ```bash
  node scripts/setup-hubspot-properties.js
  ```

- **Webhook de HubSpot:** en tu private app (Development → Legacy apps → tu app), pestaña **Webhooks** → "Edit webhooks" → Target URL = `https://TU-DOMINIO/webhooks/hubspot` → "Create subscription" → objeto `Tickets`, evento `Property changed`, propiedad `hs_pipeline_stage` → Subscribe → Commit changes. La firma de la petición se verifica con `HUBSPOT_APP_SECRET`, que es el "Client secret" visible en la pestaña **Auth** de la private app ("Show secret").

## Levantar el proyecto localmente

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Levantar MongoDB con Docker:

   ```bash
   docker compose up -d mongo
   ```

3. Arrancar la app:

   ```bash
   npm start
   ```

   El servidor queda escuchando en `http://localhost:3000` (`GET /health` para verificar).

### Con Docker Compose completo

`docker-compose.yml` también define el servicio `app` (build desde el `Dockerfile`), por lo que se puede levantar todo con:

```bash
docker compose up -d
```

En ese caso `MONGO_URI` se sobreescribe internamente a `mongodb://mongo:27017/slack_hubspot` (red interna de Docker), así que no hace falta tocar el `.env` para ese modo.

## Tests

```bash
npm test          # corre una vez
npm run test:watch
```

Usa Vitest con `mongodb-memory-server` (Mongo en memoria, sin dependencias externas) y `supertest` para los tests de endpoints.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Healthcheck, responde `{ status: 'ok' }` |
| `POST` | `/webhooks/hubspot` | Webhook subscription de HubSpot (`ticket.propertyChange`). Requiere firma válida (`x-hubspot-signature` o `x-hubspot-signature-v3`) y body como array de eventos |
