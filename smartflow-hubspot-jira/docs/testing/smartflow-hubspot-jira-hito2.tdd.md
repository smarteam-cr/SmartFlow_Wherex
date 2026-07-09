# Hito 2 — Evidencia TDD (Vie: Flujo A completo)

**Proyecto:** `smartflow-hubspot-jira`
**Rama:** `feat/hito1-bootstrap`
**Hito:** 2 de 4 (Vie)
**Stack de testing:** Vitest 2.1 + CommonJS + `mongodb-memory-server` + `supertest` (mirror del sibling)

## Source plan

- `docs/2026-07-08_092720-jira-hubspot-documentacion.md` (secciones 3–4, 6, 7, 8)
- `docs/testing/smartflow-hubspot-jira-hito1.tdd.md` (hito previo)
- No se proporcionó `*.plan.md`; los user journeys se derivan directamente de la doc.

## User journeys cubiertos en este hito

6. **Como job, leo issues de JIRA con paginación `nextPageToken`** y armo una JQL con `updated >= watermark`.
7. **Como job, agrego comentarios en JIRA en formato ADF** cuando una Task se completa en HubSpot.
8. **Como job, transiciono issues a Done** (opcional, configurable).
9. **Como job, extraigo texto plano de la descripción ADF** del issue para poblar `hs_task_body`.
10. **Como job, dedup contra HubSpot por `jira_issue_key` con doble red** (Search API + índice único Mongo).
11. **Como operador, ejecuto una corrida con N proyectos y un `pollIntervalMin`** que no avanza el watermark si JIRA falla.

## Features y mapeo → test → evidencia

| # | Feature | RED commit | GREEN commit | Test target | Resultado |
|---|---|---|---|---|---|
| F4 | `src/services/jira.js` (search, addComment, transitionIssue, respondToIssue) | `60e145e` | `3845db5` | `test/jira.test.js` | 13/13 PASS |
| F5 | `src/utils/adf.js` (extractDescription walker) | `e93db76` | `cb09d0b` | `test/adf.test.js` | 10/10 PASS |
| F6 | `src/services/hubspot.js` (findTaskByJiraKey, createTask, getTask, updateTask) | `b3bee46` | `9ee9a2e` | `test/hubspot.test.js` | 14/14 PASS |
| F7 | `src/jobs/ingestJira.js` (run con watermark, dedup, per-project, skip subtasks/terminal) | `231a3f2` | `3879526` | `test/ingestJira.test.js` | 13/13 PASS |
| F8 | `src/scheduler.js` (cron `*/N * * * *` con `cron` inyectable) | `c3a75df` | `9469a5e` | `test/scheduler.test.js` | 8/8 PASS |
| W1 | Wireup en `src/server.js` (jira+hubspot+ingest+scheduler) | — | (en `9469a5e`) | `test/server.test.js` (sin regresiones) | 6/6 PASS |

## Comandos ejecutados y resultados (resumen)

```bash
$ npm test
 ✓ test/adf.test.js (10 tests)
 ✓ test/config.test.js (15 tests)
 ✓ test/hubspot.test.js (14 tests)
 ✓ test/scheduler.test.js (8 tests)
 ✓ test/jira.test.js (13 tests)
 ✓ test/ingestJira.test.js (13 tests)
 ✓ test/server.test.js (6 tests)
 ✓ test/mongo.test.js (10 tests)
 Test Files  8 passed (8)
      Tests  89 passed (89)
```

```bash
$ npm run test:coverage
 % Coverage report from v8
----------------|---------|----------|---------|---------|----------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------|---------|----------|---------|---------|----------------------
All files       |    97.3 |    83.43 |     100 |    97.3 |
 src            |     100 |      100 |     100 |     100 |
  config.js     |     100 |      100 |     100 |     100 |
  scheduler.js  |     100 |      100 |     100 |     100 |
 src/db         |     100 |    66.66 |     100 |     100 |
  mongo.js      |     100 |    66.66 |     100 |     100 | 11,27,32,38,49,57,64
 src/jobs       |   90.17 |    76.47 |     100 |   90.17 |
  ingestJira.js |   90.17 |    76.47 |     100 |   90.17 | 25-26,28-29,86-92
 src/routes     |     100 |      100 |     100 |     100 |
 src/services   |   97.96 |    82.14 |     100 |   97.96 |
  hubspot.js    |     100 |    84.84 |     100 |     100 | 4-11,46,57,73
  jira.js       |   96.22 |    78.26 |     100 |   96.22 | 57-58,76-77
 src/utils      |     100 |    94.11 |     100 |     100 |
  adf.js        |     100 |    94.11 |     100 |     100 | 12
----------------|---------|----------|---------|---------|----------------------
```

## Tabla de garantías (Test specification)

| # | Qué se garantiza | Archivo de test | Tipo | Resultado | Evidencia |
|---|---|---|---|---|---|
| 24 | `JiraService` quita slash final de `baseUrl` | `test/jira.test.js:strips a trailing slash from baseUrl` | unit | PASS | `npm test -- test/jira.test.js` |
| 25 | `Authorization: Basic <base64(email:token)>` correcto (vector conocido) | `test/jira.test.js:sends Basic auth header` | unit | PASS | idem |
| 26 | `searchIssues` POSTea a `/rest/api/3/search/jql` con `jql`, `fields`, `maxResults=100` | `test/jira.test.js:POSTs to /rest/api/3/search/jql` | unit | PASS | idem |
| 27 | `searchIssues` sigue `nextPageToken` y concatena issues | `test/jira.test.js:follows nextPageToken` | unit | PASS | idem |
| 28 | `searchIssues` lanza con `JIRA {status}: {body}` si no ok | `test/jira.test.js:throws with status and body` | unit | PASS | idem |
| 29 | `addComment` POSTea ADF `{type:'doc', version:1, content:[paragraph]}` | `test/jira.test.js:POSTs ADF doc body` | unit | PASS | idem |
| 30 | `transitionIssue` POSTea `{transition:{id:'31'}}` | `test/jira.test.js:POSTs to transitions` | unit | PASS | idem |
| 31 | `respondToIssue` agrega comentario y transiciona si `transitionDoneId` está seteado | `test/jira.test.js:respondToIssue: adds comment and transitions` | unit | PASS | idem |
| 32 | `respondToIssue` solo comenta si `transitionDoneId` ausente o vacío | `test/jira.test.js:respondToIssue: only adds comment` × 2 | unit | PASS | idem |
| 33 | ADF extractor maneja `null`/`undefined`/`""` → `""` | `test/adf.test.js:returns empty string` | unit | PASS | `npm test -- test/adf.test.js` |
| 34 | ADF extractor maneja `paragraph`, `heading`, `bulletList`, `hardBreak`, `codeBlock`, `blockquote` | `test/adf.test.js` × 7 | unit | PASS | idem |
| 35 | ADF extractor ignora metadatos `marks` (negrita/cursiva) | `test/adf.test.js:joins text marks as plain text` | unit | PASS | idem |
| 36 | `HubSpotService.findTaskByJiraKey` POSTea a `/crm/v3/objects/tasks/search` con `propertyName=jira_issue_key, EQ` | `test/hubspot.test.js:returns null when no tasks match` | unit | PASS | `npm test -- test/hubspot.test.js` |
| 37 | `findTaskByJiraKey` devuelve el primer resultado si `total>0` | `test/hubspot.test.js:returns the first result` | unit | PASS | idem |
| 38 | `createTask` mapea properties: `hs_task_subject`, `hs_task_status`, `hs_task_priority`, `hs_task_body`, `jira_*` | `test/hubspot.test.js:sends the expected task body` | unit | PASS | idem |
| 39 | `createTask` trunca `subject` a 120 chars y usa fallback `Issue {key}` | `test/hubspot.test.js:truncates subject` × 2 | unit | PASS | idem |
| 40 | `createTask` maneja reporter/assignee/project ausentes | `test/hubspot.test.js:handles missing reporter/assignee` | unit | PASS | idem |
| 41 | `getTask(taskId, props)` GETea con `?properties=` y devuelve `properties` | `test/hubspot.test.js:GETs the task with requested properties` | unit | PASS | idem |
| 42 | `updateTask(taskId, props)` PATCHea con `properties` | `test/hubspot.test.js:PATCHes the task` | unit | PASS | idem |
| 43 | Ingest primera corrida: ventana = `now - pollIntervalMin` | `test/ingestJira.test.js:first run uses now - pollIntervalMin` | integration | PASS | `npm test -- test/ingestJira.test.js` |
| 44 | Ingest subsiguiente: ventana = watermark persistido | `test/ingestJira.test.js:subsequent runs use the persisted watermark` | integration | PASS | idem |
| 45 | Ingest itera sobre todos los proyectos | `test/ingestJira.test.js:queries each project` | integration | PASS | idem |
| 46 | Ingest skip issues con task existente | `test/ingestJira.test.js:skips issues that already have a HubSpot task` | integration | PASS | idem |
| 47 | Ingest marca `processed_issues` con `project, issueKey, taskId` | `test/ingestJira.test.js:records each created issue in mongo` | integration | PASS | idem |
| 48 | Ingest avanza watermark al `max(updated)` | `test/ingestJira.test.js:advances the watermark` | integration | PASS | idem |
| 49 | Ingest sin issues: watermark = `now` | `test/ingestJira.test.js:sets watermark to now` | integration | PASS | idem |
| 50 | Ingest con JIRA caído: NO avanza watermark, devuelve error | `test/ingestJira.test.js:does NOT advance the watermark when JIRA throws` | integration | PASS | idem |
| 51 | Ingest continúa si 1 issue falla (no rompe la corrida) | `test/ingestJira.test.js:continues processing when one issue fails` | integration | PASS | idem |
| 52 | Ingest con `skipSubtasks=true` omite sub-tasks | `test/ingestJira.test.js:skips subtasks` | integration | PASS | idem |
| 53 | Ingest con `excludeStatuses` omite Done/Closed/Cancelled | `test/ingestJira.test.js:skips issues in terminal statuses` | integration | PASS | idem |
| 54 | Scheduler usa cron `*/5 * * * *` y registra el handler | `test/scheduler.test.js:schedules a job with the cron expression` | unit | PASS | `npm test -- test/scheduler.test.js` |
| 55 | Scheduler pasa `now: Date` a `ingest.run` y traga errores | `test/scheduler.test.js:runs the wrapped ingest and swallows errors` × 2 | unit | PASS | idem |
| 56 | `stopScheduler` llama `.stop()` al handle activo y es no-op si no hay schedule | `test/scheduler.test.js:stopScheduler calls .stop()` × 2 | unit | PASS | idem |
| 57 | Scheduler valida `intervalMin` ∈ [1, 59] e `ingest` requerido | `test/scheduler.test.js:throws when intervalMin is invalid` × 2 | unit | PASS | idem |

## Cobertura y gaps conocidos

- **Coverage reportada:** statements 97.3%, branches 83.43%, functions 100%, lines 97.3%.
- **Umbrales (vitest.config.js):** 80% en lines/branches/functions/statements. **Cumplidos.**
- **Gaps por archivo (todos son código defensivo que no es fácil de gatillar sin montar una config malformada):**
  - `src/db/mongo.js` líneas 11, 27, 32, 38, 49, 57, 64: `if (!db) throw 'mongo not connected'`. Guards sin probar.
  - `src/jobs/ingestJira.js` líneas 25–26, 28–29: throws del constructor cuando faltan `jira`/`hubspot`/`mongo` o `projects` está vacío. Líneas 86–92: catch del `markProcessed` por duplicado (`dupErr`). Estas últimas se podrían cubrir con un test de carrera (insertar manualmente antes de `markProcessed`); queda para una iteración futura si surge riesgo real.
  - `src/services/hubspot.js` líneas 4–11: throws del factory. Líneas 46, 57, 73: ramas de path/header que solo aplican a entradas sin `jiraBaseUrl` o con casos borde.
  - `src/services/jira.js` líneas 57–58, 76–77: catch de `fetch` que lanza errores de red. Difíciles de reproducir sin `fetch` que rechaza.
  - `src/utils/adf.js` línea 12: `if (!adf) return ''` cuando se pasa un string vacío (cubre solo el path `null`/`undefined` en tests; el string vacío se evalúa con `walk('', out)` que sale por el `if (!node || typeof node !== 'object')`).

## Estructura entregada en este hito

```
smartflow-hubspot-jira/src/
├── server.js              (wireup: jira + hubspot + ingest + scheduler)
├── config.js
├── db/
│   └── mongo.js
├── jobs/
│   └── ingestJira.js      (F7)
├── services/
│   ├── hubspot.js         (F6)
│   └── jira.js            (F4)
├── routes/
│   ├── health.js
│   └── webhooks.js
├── scheduler.js           (F8)
└── utils/
    └── adf.js             (F5)

smartflow-hubspot-jira/test/
├── adf.test.js
├── config.test.js
├── hubspot.test.js
├── ingestJira.test.js
├── jira.test.js
├── mongo.test.js
├── scheduler.test.js
└── server.test.js
```

## Merge evidence

| Stage | Commit | Description |
|---|---|---|
| RED F4 | `60e145e` | test: add reproducer for jira service — 13/13 fail (módulo ausente) |
| GREEN F4 | `3845db5` | fix: add jira service with search, comments and transitions — 13/13 PASS |
| RED F5 | `e93db76` | test: add reproducer for adf extractor — 10/10 fail (módulo ausente) |
| GREEN F5 | `cb09d0b` | fix: add adf to plain text extractor — 10/10 PASS |
| RED F6 | `b3bee46` | test: add reproducer for hubspot service — 14/14 fail (módulo ausente) |
| GREEN F6 | `9ee9a2e` | fix: add hubspot service with search, create, get and update task — 14/14 PASS |
| RED F7 | `231a3f2` | test: add reproducer for ingest job — 13/13 fail (módulo ausente) |
| GREEN F7 | `3879526` | fix: add ingest job with watermark, dedup and per-project iteration — 13/13 PASS |
| RED F8 | `c3a75df` | test: add reproducer for scheduler — 6/6 fail (módulo ausente) |
| GREEN F8 | `9469a5e` | fix: add cron scheduler with injectable module and error swallowing — 8/8 PASS |
| W1 wireup | (en `9469a5e`) | refactor: wire jira, hubspot, ingest and scheduler into server start — sin regresiones (89/89) |

**Total: 89/89 tests passing · coverage 97.3 / 83.43 / 100 / 97.3 % (umbrales 80% cumplidos).**

## Decisiones de diseño relevantes

1. **`scheduler.js` con `cron` inyectable.** El primer intento con `vi.doMock('node-cron')` no funcionó porque `require` cachea. Cambié a DI: `startScheduler({ ingest, intervalMin, cron })`. Testeable, sin importar el módulo real en CI.
2. **`JiraService.respondToIssue(issueKey, { transitionDoneId })`** recibe la opción por parámetro (no lee `process.env` directo). Permite que el job de ingesta y el webhook lo invoquen con la misma lógica. El `JIRA_TRANSITION_DONE_ID` lo resuelve `server.js` desde config.
3. **`createTask` trunca el subject a 120 chars** porque HubSpot limita `hs_task_subject`. Test explícito con `summary` de 200 chars.
4. **Watermark no avanza si JIRA falla.** Si todas las búsquedas de proyectos fallan, no se llama `setWatermark`. Si al menos una tuvo éxito, se llama con `max(updated) || now`. Decisión: si una parte de los proyectos falla pero otra tiene datos, igual avanzamos con lo que tenemos.
5. **Ingest maneja duplicados por carrera en `markProcessed`.** Si dos ingestas paralelas procesan el mismo `issueKey`, el índice único Mongo hace que la segunda falle. La capturamos y marcamos como `skipped` con un `error` informativo, sin romper la corrida.
6. **Retry con backoff queda diferido a F10 (Hito 3).** Los servicios `JiraService` y `HubSpotService` solo hacen el HTTP call directo. Cuando llegue F10, envolveremos las llamadas con `withRetry`. Esto se decidió para mantener Hito 2 acotado y llegar antes al Flujo B.

## Pendientes para Hito 3 (F9, F10)

- **F9 — Webhook `/webhooks/hubspot`** con verificación de token (header), extracción de `taskId`, llamada a `respondToIssue`, idempotencia con `jira_listo_sent`.
- **F10 — `src/utils/retry.js`** (`withRetry(fn, { retries, baseMs, isRetryable, sleepFn })`) con tests específicos de backoff y 429.
- **Refactor:** envolver `http` de `JiraService` y `HubSpotService` con `withRetry` (F10 ya implementado).
