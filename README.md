# SmartFlow_Wherex

Servicio unificado de integraciones **HubSpot ↔ Jira** y **HubSpot ↔ Slack**, corriendo como un solo proceso Node.js (Fastify) sobre una única base MongoDB (`WherEXdb`).

Cada integración vive en su propio namespace de rutas y config, así que una variable de entorno faltante o un fallo en una integración no tumba a la otra.

## Arquitectura

```
index.js              # entry point: carga .env, arranca el proceso
src/
├── app.js             # createApp() — instancia Fastify, registra rutas
├── start.js           # start() — conecta Mongo, arma integraciones, arranca scheduler
├── config/            # loadConfig(env) — config por integración, nunca lanza excepción
├── db/connection.js   # conexión Mongo compartida
├── modules/
│   ├── jira/           # services, jobs de ingesta, store (watermark/dedup)
│   └── slack/          # ídem para Slack
├── routes/
│   ├── health.js        # GET /healthz
│   ├── jira/webhooks.js
│   └── slack/webhooks.js
└── shared/              # hubspotSignature (HMAC), retry, scheduler
```

## Rutas

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/healthz` | Estado del proceso y ping a Mongo |
| `POST` | `/jira/webhooks/hubspot` | Webhook de HubSpot para la integración Jira |
| `POST` | `/slack/webhooks/hubspot` | Webhook de HubSpot para la integración Slack |

Cada integración arranca solo si su configuración es válida. Si Jira y Slack están mal configurados a la vez, el proceso se niega a arrancar.

## Configuración

Copiá `.env.example` a `.env` y completá las variables. Las credenciales de HubSpot son de apps privadas distintas por integración, por eso están namespaceadas (`JIRA_HUBSPOT_*` / `SLACK_HUBSPOT_*`).

```bash
cp .env.example .env
```

Variables principales:

- **Compartidas**: `PORT`, `MONGO_URI`, `POLL_INTERVAL_MIN`
- **Jira**: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_TRANSITION_DONE_ID`, `JIRA_HUBSPOT_*`
- **Slack**: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_HUBSPOT_*`

## Desarrollo

```bash
npm install
npm test              # vitest
npm run test:coverage # vitest + cobertura (umbral 80%)
npm start              # node index.js
```

## Docker

```bash
docker compose up --build
```

Un solo servicio (`app`) expuesto en el puerto configurado (por defecto `3000`), con healthcheck contra `/healthz`.

## Proyectos previos (legacy)

`smartflow-hubspot-jira/` y `smartflow-hubspot-slack/` son los dos servicios independientes que existían antes de esta unificación. Se mantienen en el repo como referencia/rollback y serán eliminados en un commit aparte una vez confirmado el corte en producción — ver [docs/2026-07-09_plan-restructuracion-monolito.md](docs/2026-07-09_plan-restructuracion-monolito.md).
