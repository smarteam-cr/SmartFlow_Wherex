# CLAUDE.md

Guía de referencia para trabajar en este repo con Claude Code. Ver también [README.md](README.md) para la arquitectura general.

## Proyecto

**SmartFlow_Wherex** (`smartflow-monolith` en package.json) es un servicio Node.js/Fastify que sincroniza datos hacia HubSpot (CRM) desde dos fuentes:

- **Jira** → tickets de HubSpot (proyecto `P30`, Jira Service Management).
- **Slack** → tickets de HubSpot (mensajes de un canal específico).

Corre como un solo proceso sobre una única base MongoDB compartida (`WherEXdb`). Cada integración vive en su propio namespace de config/rutas: si a una le falta una env var, esa integración se apaga sola pero la otra sigue funcionando (`canStart = shared.ok && (jira.ok || slack.ok)`, `src/config/index.js`).

```
index.js              # entry point: carga .env, arranca el proceso
src/
├── app.js             # createApp() — instancia Fastify, registra rutas
├── start.js           # start() — conecta Mongo, arma integraciones, arranca scheduler
├── config/            # loadConfig(env) — config por integración, nunca lanza excepción
├── db/connection.js   # conexión Mongo compartida
├── modules/
│   ├── jira/           # services (Jira + HubSpot API), jobs/ingest.js, store (watermark/dedup), utils
│   └── slack/           # ídem para Slack
├── routes/
│   ├── health.js         # GET /healthz
│   ├── jira/webhooks.js  # POST /jira/webhooks/hubspot
│   └── slack/webhooks.js # POST /slack/webhooks/hubspot
└── shared/               # hubspotSignature (HMAC), retry, scheduler (node-cron)
```

Cada integración es: **polling job** (`jobs/ingest.js`, corre en cron cada `POLL_INTERVAL_MIN`, trae datos nuevos de Jira/Slack y crea tickets en HubSpot) + **webhook** (`routes/*/webhooks.js`, recibe eventos de HubSpot — ej. ticket cerrado — y responde de vuelta a Jira/Slack). No hay webhook de Jira/Slack hacia este servicio; la entrada de datos siempre es por polling.

**Despliegue:** Docker (`Dockerfile`, puerto `3006`), healthcheck contra `/healthz`. **Hay un contenedor corriendo en un servidor separado de este working directory** (el `.env` local apunta a `MONGO_URI=mongodb://host.docker.internal:...`, típico de esa configuración). Los cambios hechos acá **no se reflejan solos** en ese servicio — hace falta desplegar (`git pull` + rebuild/restart) para que apliquen de verdad.

## Comandos

```bash
npm install
npm test               # vitest run — toda la suite
npm run test:watch     # vitest en modo watch
npm run test:coverage  # vitest + cobertura v8 (umbral 80% líneas/funciones/branches/statements)
npm start               # node index.js — arranca el proceso real (conecta Mongo, HubSpot, Jira, Slack)
docker compose up --build
```

Scripts de diagnóstico (usan las credenciales reales de `.env`, son de solo lectura salvo que se indique lo contrario):

- `node scripts/check-jira-issue.js [ISSUE_KEY]` — revisa si un issue de Jira ya tiene ticket en HubSpot, o si el próximo run del job de ingesta lo tomaría. Sin argumento, revisa el último issue actualizado del proyecto configurado.
- `node scripts/setup-hubspot-properties.js` — **escribe**: provisiona en HubSpot las propiedades custom de Ticket que el código espera (`jira_issue_key`, `jira_project_key`, etc). Correrlo solo si HubSpot todavía no las tiene.

## Convenciones de código

- CommonJS puro (`"type": "commonjs"`), sin TypeScript. Requiere Node ≥18 (usa `fetch` global de Node, no axios/node-fetch).
- Cada integración (`modules/jira/`, `modules/slack/`) sigue la misma forma:
  - `services/` — clientes HTTP a APIs externas (Jira, HubSpot), auth + `withRetry` (`shared/retry.js`) + manejo de errores (`err.status`, `err.retryAfterMs`, `err.source`).
  - `jobs/ingest.js` — el job de polling: JQL/query, filtros, dedup, creación de ticket.
  - `store.js` — persistencia Mongo (watermark + dedup), acceso directo vía driver `mongodb`, sin ORM.
  - `utils/` — funciones puras (parsing, formateo), sin dependencias externas.
- `config/<integracion>.js` expone `loadXConfig(env)` → `{ ok, errors, values }`, **nunca lanza excepción** (config inválida = integración deshabilitada, no crash). `config/index.js` compone todas.
- Filtros/params opcionales en los jobs de ingesta siguen el patrón "default no-op": si no se configura explícitamente (env var vacía → array/false por defecto), el comportamiento no cambia. Ver `skipSubtasks`, `excludeStatuses`, `assistanceTypeFieldIds` en `modules/jira/jobs/ingest.js`.
- Tests con Vitest, archivos en **ESM** (`import`) que cargan el código fuente CJS vía `createRequire(import.meta.url)`. Mocks manuales (`vi.fn()`) para servicios externos (Jira/HubSpot); `mongodb-memory-server` para tests que tocan el store real (nada de mocks de Mongo). Convención de nombres: `test/<integracion>/<tipo>-<nombre>.test.js` (`jobs-ingest.test.js`, `services-jira.test.js`, `utils-issueNote.test.js`).
- Antes de dar por terminado un cambio: `npm test` debe pasar completo, y si el cambio toca un flujo con efectos reales (crea/edita algo en Jira o HubSpot), preferir un dry-run con los clientes externos "fakeados" en memoria antes de correrlo contra los sistemas reales.

## Seguridad

- **Secretos solo en `.env`** (gitignored). Nunca commitear credenciales ni pegarlas en texto. Validar `git status` antes de cada commit.
- **No usar nombres de clientes ni dominios** que no se hayan dado explícitamente.
- **Commits de una línea** (máx. 2). **Nunca** agregar coautoría de Claude/IA ni "Generated with…".
- No exponer tokens en mensajes de error/logs (se truncan/redactan).

## Bases de datos

MongoDB, base compartida **`WherEXdb`** entre Jira y Slack (mismas credenciales, colecciones separadas por nombre — ver `docs/2026-07-09_plan-compartir-mongodb-jira-slack.md`). Conexión centralizada en `src/db/connection.js` (`connect`/`getDb`/`close`).

| | Jira (`modules/jira/store.js`) | Slack (`modules/slack/store.js`) |
|---|---|---|
| Dedup | `processed_issues`, índice único `{ project, issueKey }` | `processed_messages`, índice único `{ channel, ts }` |
| Watermark (cursor de polling) | doc `_id: 'jira_ingest'` en `watermark` | doc `_id: 'slack_ingest'` en `watermark` |

No hay ORM ni migraciones — los índices se crean en runtime vía `ensureIndexes()` (llamado en `src/start.js` al arrancar).

## Estado del proyecto

- Arquitectura actual: **monolito unificado** (desde commit `3ddbe2c`), reemplaza dos servicios standalone que existían antes.
- `smartflow-hubspot-jira/` y `smartflow-hubspot-slack/` en la raíz del repo son el **código legacy pre-monolito** — se mantienen temporalmente como referencia/rollback, no son el código vivo, y están pendientes de eliminar en un commit aparte una vez confirmado el corte en producción (ver `docs/2026-07-09_plan-restructuracion-monolito.md`).
- Filtro Jira→HubSpot por "Tipo de Asistencia" (solo sincroniza issues clasificados como `CC`, ver `docs/2026-07-15_plan-filtro-tipo-asistencia-cc.md`) implementado y verificado con dry-run contra Jira real; **pendiente de commit y de deploy** al servidor en vivo.
- Hay un despliegue en vivo separado de este working directory — ver nota de Despliegue arriba.

## Mapas de código y referencias

No existen codemaps generados (`docs/CODEMAPS/`) todavía — si hacen falta, correr el skill `/update-codemaps`.

Docs de planeación existentes en `docs/`:

- [README.md](README.md) — arquitectura general, rutas, variables de entorno.
- [docs/2026-07-09_plan-restructuracion-monolito.md](docs/2026-07-09_plan-restructuracion-monolito.md) — plan de la migración de dos servicios standalone a este monolito.
- [docs/2026-07-09_plan-compartir-mongodb-jira-slack.md](docs/2026-07-09_plan-compartir-mongodb-jira-slack.md) — plan de la base Mongo compartida `WherEXdb`.
- [docs/2026-07-15_plan-filtro-tipo-asistencia-cc.md](docs/2026-07-15_plan-filtro-tipo-asistencia-cc.md) — filtro de tickets Jira→HubSpot por "Tipo de Asistencia" = CC.
- [docs/testing/2026-07-09-restructuracion-monolito.tdd.md](docs/testing/2026-07-09-restructuracion-monolito.tdd.md) — plan TDD de la restructuración a monolito.
