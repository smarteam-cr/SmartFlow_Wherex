# smartflow-hubspot-jira

Integracion entre **JIRA Cloud** y **HubSpot CRM**: ingesta periodica de issues a Tasks, y callback de finalizacion (Task completed -> comentario + transicion opcional en JIRA).

Sigue el mismo patron que `../smartflow-hubspot-slack`: monolito Node.js + Express, cron para ingesta, endpoint HTTP para callbacks.

## Stack
- Node.js 20 + Express
- node-cron (ingesta cada N min)
- MongoDB (watermark + dedup)
- Vitest (unit + integration con `mongodb-memory-server` + `supertest`)

## Configuracion

Copia `.env.example` a `.env` y completa los valores.

| Variable | Obligatorio | Descripcion |
|---|---|---|
| `JIRA_BASE_URL` | si | `https://tu-org.atlassian.net` (sin slash final) |
| `JIRA_EMAIL` | si | Cuenta Atlassian dueña del API token |
| `JIRA_API_TOKEN` | si | Token de https://id.atlassian.com/manage-profile/security/api-tokens |
| `JIRA_PROJECT_KEY` | si | Uno o varios (separados por coma) |
| `JIRA_TRANSITION_DONE_ID` | no | ID de la transicion a "Done" para el Flujo B |
| `HUBSPOT_TOKEN` | si | Token de la app privada de HubSpot |
| `POLL_INTERVAL_MIN` | no | Minutos entre corridas (default 5) |
| `PORT` | no | Puerto HTTP (default 3000) |
| `WEBHOOK_SECRET` | si | Token compartido con la accion Send Webhook de HubSpot |
| `MONGO_URI` | si | URI de MongoDB |

## Arranque local

```bash
npm install
npm start
```

## Tests

```bash
npm test              # una corrida
npm run test:watch    # watch
npm run test:coverage # reporte de cobertura
```

## Deploy

```bash
docker compose up -d
```

## Estado

MVP en construccion. Hito 1 (bootstrap, Mongo, healthcheck) completado.
