# Hito 4 — Evidencia TDD (Lun: e2e + deploy)

**Proyecto:** `smartflow-hubspot-jira`
**Rama:** `feat/hito1-bootstrap`
**Hito:** 4 de 4 (Lun)
**Stack de testing:** Vitest 2.1 + CommonJS + `mongodb-memory-server` + `supertest`

## Source plan

- `docs/2026-07-08_092720-jira-hubspot-documentacion.md` (sección 12 — Plan Jue→Lun)
- `docs/testing/smartflow-hubspot-jira-hito1..3.tdd.md` (hitos previos)

## User journeys cubiertos en este hito

18. **Como operador, una corrida de ingesta + un webhook + un reintento del webhook funcionan juntos sin duplicar trabajo.**
19. **Como operador, dos ingestas concurrentes con el mismo issue no crean dos tasks** (índice único Mongo + dedup por Search API).
20. **Como operador, `npm start` arranca el monolito end-to-end** (Mongo + scheduler + HTTP server) sin pasos manuales.
21. **Como nuevo desarrollador, el README documenta la arquitectura, configuración, permisos, propiedades custom de HubSpot y el setup del workflow de HubSpot.**

## Features y mapeo → test → evidencia

| # | Feature | RED commit | GREEN commit | Test target | Resultado |
|---|---|---|---|---|---|
| F11 | E2E integration (ingest + webhook + dedup concurrente) | `e282038` | (mismo) | `test/e2e.test.js` | 9/9 PASS |
| F12 | Deploy artifacts: `.dockerignore`, README completo, smoke test de `npm start` | (en `f2b...` siguiente) | `f2b...` | `test/smoke.test.js` | 2/2 PASS |
| R2 | `start()` retorna el server handle (para tests de smoke) | — | (en `f2b...`) | sin regresiones (130/130) | OK |

## Comandos ejecutados y resultados

```bash
$ npm test
 ✓ test/adf.test.js (10 tests)
 ✓ test/config.test.js (15 tests)
 ✓ test/hubspot.test.js (16 tests)
 ✓ test/retry.test.js (10 tests)
 ✓ test/scheduler.test.js (8 tests)
 ✓ test/jira.test.js (15 tests)
 ✓ test/ingestJira.test.js (13 tests)
 ✓ test/webhooks.test.js (14 tests)
 ✓ test/server.test.js (8 tests)
 ✓ test/mongo.test.js (10 tests)
 ✓ test/e2e.test.js (9 tests)
 ✓ test/smoke.test.js (2 tests)
 Test Files  12 passed (12)
      Tests  130 passed (130)
```

```bash
$ npm run test:coverage
 % Coverage report from v8
----------------|---------|----------|---------|---------|-------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------|---------|----------|---------|---------|-------------------
All files       |   96.94 |    86.11 |     100 |   96.94 |
 src            |     100 |      100 |     100 |     100 |
  config.js     |     100 |      100 |     100 |     100 |
  scheduler.js  |     100 |      100 |     100 |     100 |
 src/db         |     100 |    72.72 |     100 |     100 |
  mongo.js      |     100 |    72.72 |     100 |     100 | 27,32,38,49,57,64
 src/jobs       |   96.42 |       80 |     100 |   96.42 |
  ingestJira.js |   96.42 |       80 |     100 |   96.42 | 25-26,28-29
 src/routes     |   94.78 |     91.3 |     100 |   94.78 |
  health.js     |     100 |      100 |     100 |     100 |
  webhooks.js   |   93.75 |    90.47 |     100 |   93.75 | 10-11,51-54
 src/services   |   95.79 |    81.25 |     100 |   95.79 |
  hubspot.js    |   95.76 |     82.6 |     100 |   95.76 | 9,11-14
  jira.js       |   95.83 |    79.41 |     100 |   95.83 | 8,10-13
 src/utils      |   97.77 |    93.18 |     100 |   97.77 |
  adf.js        |     100 |    94.11 |     100 |     100 | 12
  retry.js      |      95 |    92.59 |     100 |      95 | 14-15
----------------|---------|----------|---------|---------|-------------------
```

## Tabla de garantías (Test specification — sólo garantías nuevas de Hito 4)

| # | Qué se garantiza | Archivo de test | Tipo | Resultado | Evidencia |
|---|---|---|---|---|---|
| 82 | Ingest crea 1 task en HubSpot por issue y registra `processed_issues` en Mongo | `test/e2e.test.js:ingest crea tasks en HubSpot y marca processed_issues` | e2e | PASS | `npm test -- test/e2e.test.js` |
| 83 | Webhook con task `COMPLETED` retorna 200, llama `getTask` + `respondToIssue` + `updateTask` (4 fetch calls) | `test/e2e.test.js:webhook con task COMPLETED responde 200 ok` | e2e | PASS | idem |
| 84 | Segundo webhook con la misma task → `skipped: 'duplicate'`, sólo 1 fetch call (a HubSpot getTask) | `test/e2e.test.js:segundo webhook con la misma task: skipped duplicate` | e2e | PASS | idem |
| 85 | Ingest concurrente con el mismo `issueKey` → solo 1 task creada (índice único Mongo) | `test/e2e.test.js:ingest concurrente con el mismo issueKey` | e2e | PASS | idem |
| 86 | Cross-flow completo: ingest → webhook → segundo webhook (idempotente) | `test/e2e.test.js:cross-flow completo` | e2e | PASS | idem |
| 87 | Webhook sin token → 401, sin fetch calls | `test/e2e.test.js:webhook sin token: 401` | e2e | PASS | idem |
| 88 | `/healthz` responde 200 antes y después de una corrida de ingesta | `test/e2e.test.js:healthz responde 200 antes y despues` | e2e | PASS | idem |
| 89 | JIRA caído en ingesta → watermark NO avanza, próxima corrida recupera | `test/e2e.test.js:JIRA caido en ingesta` | e2e | PASS | idem |
| 90 | JIRA falla en `respondToIssue` del webhook → 500 (HubSpot reintenta) | `test/e2e.test.js:JIRA falla en respondToIssue del webhook` | e2e | PASS | idem |
| 91 | `npm start` arranca y `/healthz` retorna 200 con `mongo:up` | `test/smoke.test.js:exposes /healthz with status 200 and mongo:up` | smoke | PASS | `npm test -- test/smoke.test.js` |
| 92 | `npm start` levanta el endpoint `/webhooks/hubspot` con auth 401 sin token | `test/smoke.test.js:rejects unauthenticated POST /webhooks/hubspot with 401` | smoke | PASS | idem |

## Cobertura y gaps conocidos

- **Coverage reportada:** statements 96.94%, branches 86.11%, functions 100%, lines 96.94%.
- **Umbrales (80%):** **cumplidos** en lines/branches/functions/statements.
- **`src/server.js` excluido por config** (entrypoint; smoke test lo valida end-to-end con un proceso real, lo que es más fuerte que cobertura de líneas).
- **Gaps por archivo (código defensivo, no afecta comportamiento):**
  - `src/utils/retry.js` 14–15: validación de `retries`.
  - `src/services/jira.js` 8, 10–13: throws del factory (constructor validation).
  - `src/services/hubspot.js` 9, 11–14: throws del factory.
  - `src/routes/webhooks.js` 10–11: throws del factory. 51–54: path de error genérico de `getTask` (no 404).
  - `src/jobs/ingestJira.js` 25–26, 28–29: throws del factory del job.
  - `src/db/mongo.js` 27, 32, 38, 49, 57, 64: guards `if (!db) throw 'mongo not connected'`.
  - `src/utils/adf.js` 12: `if (!adf) return ''` cuando el argumento es string vacío.

## Estructura entregada en este hito

```
smartflow-hubspot-jira/
├── .dockerignore                   (NUEVO — excluye node_modules, coverage, tests, .git, .env)
├── README.md                       (reescrito: arquitectura completa, env vars, permisos, setup HubSpot)
├── test/
│   ├── e2e.test.js                 (NUEVO — 9 tests, ambos flujos + cross-flow + dedup concurrente)
│   └── smoke.test.js               (NUEVO — 2 tests, valida `npm start` end-to-end)
└── src/
    └── server.js                   (refactor: `start()` retorna el server handle)
```

## Decisiones de diseño relevantes

1. **`e2e.test.js` con servicios reales (no mocks).** A diferencia de los tests unitarios (que mockean `fetch`), los e2e usan las factories reales (`createJiraService`, `createHubSpotService`, `createIngestJob`) y solo mockean `fetch`. Esto valida que la integración entre servicios funciona, no solo cada pieza aislada.
2. **`smoke.test.js` arranca el entrypoint real.** Llama a `start()`, espera a que escuche, hace requests HTTP reales (no supertest), verifica `/healthz` y el 401 del webhook. Es la verificación más cercana a producción que podemos hacer sin Docker.
3. **`start()` retorna el server handle.** Esto era necesario para que el smoke test pueda cerrarlo. En producción, `npm start` ignora el valor de retorno y el proceso se queda vivo.
4. **Mock del cron en smoke test.** Para que el test no dispare la ingesta real ni acumule timers, el `cron.schedule` se mockea a un `{ stop }` no-op.
5. **`.dockerignore` excluye `test/`, `docs/`, `.vscode/`.** La imagen de Docker solo debe contener `src/`, `package.json`, `package-lock.json` y lo necesario para `npm start`.

## Comandos para el operador (resumen final)

```bash
# 1. Setup
cd smartflow-hubspot-jira
cp .env.example .env
# editar .env con JIRA_*, HUBSPOT_TOKEN, WEBHOOK_SECRET, MONGO_URI

# 2. Crear propiedades custom en HubSpot (UI: Settings → Properties → Tasks)
#    jira_issue_key, jira_project_key, jira_url, jira_reporter, jira_assignee, jira_comment_id, jira_listo_sent

# 3. Crear workflow en HubSpot (Automation → Workflows)
#    Object: Tasks
#    Trigger: hs_task_status is COMPLETED
#    Action: Send a webhook (POST) a https://TU-DOMINIO/webhooks/hubspot
#            Header: X-Webhook-Token: <valor de WEBHOOK_SECRET>
#            Body:   { "objectId": "{{task.id}}" }

# 4. Arrancar
docker compose up -d
# o localmente:
npm install && npm start

# 5. Verificar
curl http://localhost:3000/healthz
# { "ok": true, "mongo": "up" }
```

## Resumen de la entrega completa (4 hitos)

| Hito | Features | Tests | Coverage | Estado |
|---|---|---|---|---|
| 1 (Jue) | config, mongo, server + healthcheck | 31 | 100% | ✅ |
| 2 (Vie) | jira, adf, hubspot, ingest, scheduler | +58 (89) | 97.3% | ✅ |
| 3 (Sáb/Dom) | webhook, retry, wrap servicios | +30 (119) | 95.97% | ✅ |
| 4 (Lun) | e2e, smoke, deploy artifacts | +11 (130) | 96.94% | ✅ |

**Total: 130/130 tests passing · coverage 96.94 / 86.11 / 100 / 96.94% (umbrales 80% cumplidos).**

## Merge evidence

Si se squashean los checkpoint commits, copiar este bloque al PR body / squash commit body:

| Stage | Commit | Description |
|---|---|---|
| RED F1 | `9b3822a` | test: add reproducer for config — 15/15 fail (módulo ausente) |
| GREEN F1 | `ca201ce` | fix: load and validate env config — 15/15 PASS |
| RED F2 | `cc76325` | test: add reproducer for mongo — 10/10 fail |
| GREEN F2 | `ad8e0e2` | fix: add mongo watermark and processed_issues with unique index — 10/10 PASS |
| RED F3 | `32baa5d` | test: add reproducer for express server — 6 fail |
| GREEN F3 | `cdb2956` | fix: add express server with healthcheck and webhook placeholder — 6/6 PASS |
| RED F4 | `60e145e` | test: add reproducer for jira service — 13/13 fail |
| GREEN F4 | `3845db5` | fix: add jira service — 13/13 PASS |
| RED F5 | `e93db76` | test: add reproducer for adf extractor — 10/10 fail |
| GREEN F5 | `cb09d0b` | fix: add adf extractor — 10/10 PASS |
| RED F6 | `b3bee46` | test: add reproducer for hubspot service — 14/14 fail |
| GREEN F6 | `9ee9a2e` | fix: add hubspot service — 14/14 PASS |
| RED F7 | `231a3f2` | test: add reproducer for ingest job — 13/13 fail |
| GREEN F7 | `3879526` | fix: add ingest job — 13/13 PASS |
| RED F8 | `c3a75df` | test: add reproducer for scheduler — 6/6 fail |
| GREEN F8 | `9469a5e` | fix: add cron scheduler — 8/8 PASS |
| R1 wireup | `68525a0` | refactor: wire jira, hubspot, ingest and scheduler into server start |
| RED F10 | `6692728` | test: add reproducer for retry helper — 10/10 fail |
| GREEN F10 | `36dee14` | fix: add withRetry helper — 10/10 PASS |
| R1 wrap | `299821f` | refactor: wrap jira and hubspot with withRetry — +4 tests |
| RED F9 | `889bd21` | test: add reproducer for webhooks route — 14/14 fail |
| GREEN F9 | `21a169c` | fix: add hubspot webhook handler — 14/14 PASS |
| F11 e2e | `e282038` | test: add end-to-end tests — 9/9 PASS (mismo commit) |
| F12 deploy | `f2b...` (siguiente) | feat: add dockerignore, full README and smoke test for npm start — 2/2 smoke + 130/130 total |

(Para el SHA exacto de F12, ver `git log --oneline main..HEAD` en la rama.)
