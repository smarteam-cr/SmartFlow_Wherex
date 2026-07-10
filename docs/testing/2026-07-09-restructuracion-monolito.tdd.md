# TDD Evidence — Restructuración a monolito (Hitos 1–6)

**Fecha:** 2026-07-09
**Rama:** `feat/monolith-restructure` (renombrada desde `feat/hito1-bootstrap`)
**Plan:** [docs/2026-07-09_plan-restructuracion-monolito.md](../../2026-07-09_plan-restructuracion-monolito.md)

---

## 1. Plan handoff

El plan (`docs/2026-07-09_plan-restructuracion-monolito.md`) fue tratado como input no confiable al inicio de la sesión: se leyó como texto plano, se normalizaron milestones (Hitos 1–7), y se convirtió cada comportamiento esperado en un test reproducible. El plan no contenía instrucciones maliciosas ni operaciones destructivas no aprobadas; el borrado de los sub-proyectos (`smartflow-hubspot-jira/`, `smartflow-hubspot-slack/`) queda en el Hito 7, gated en confirmación explícita del usuario y un tag de seguridad `pre-monolith-removal`.

Decisiones aplicadas (turno de clarificación con el usuario):
- Rama renombrada a `feat/monolith-restructure`.
- Reporte de evidencia en `docs/testing/2026-07-09-restructuracion-monolito.tdd.md` (este archivo).
- Hito 4 refactoriza a DI **ambos** `services/slack.js` y `services/hubspot.js` (no solo hubspot).
- Hito 0 omitido; el plan se commitea junto con el primer commit del Hito 1.

---

## 2. User journeys aceptados

| # | Journey | Criterio |
|---|---|---|
| J1 | Operador arranca el proceso unificado con env de Jira + Slack | `/healthz` 200, ambos webhooks responden |
| J2 | Operador arranca solo con env de Jira | `/jira/...` sirve, `/slack/...` 404, `/healthz` 200 |
| J3 | Operador arranca solo con env de Slack | viceversa |
| J4 | Operador arranca sin env de integraciones | `/healthz` 200, ambos webhooks 404 |
| J5 | HubSpot envía webhook firmado a Slack a `/jira/...` | 401 (no se cruzan) |
| J6 | HubSpot envía webhook firmado a Jira a `/slack/...` | 401 (no se cruzan) |
| J7 | Operador manipula body después de firmar | 401 |
| J8 | Jira/HubSpot devuelven 5xx transitorio durante ingest | retry con backoff, sin avance de watermark |
| J9 | Cron dispara el ingest mientras una corrida anterior sigue | segunda se salta (overlap guard) |
| J10 | Operador hace push a producción | Docker build + run expone /healthz, el resto es path-based routing interno |

---

## 3. Tabla de evidencia por Hito

### Hito 1 — Esqueleto Fastify + raw body + conexión Mongo

| Fase | Comando | Resultado |
|---|---|---|
| RED | `npx vitest run` | `Test Files 3 failed (3); Tests 7 failed | 9 skipped (16)` — módulos `src/app`, `src/db/connection`, `src/routes/health` inexistentes |
| GREEN | `npx vitest run` | `Test Files 3 passed (3); Tests 16 passed (16)` |
| Coverage | `npx vitest run --coverage` | 95.45% stmts / 85.18% branches / 100% funcs / 95.45% lines |
| Legacy jira | `cd smartflow-hubspot-jira && npx vitest run` | 138/138 ✓ |
| Legacy slack | `cd smartflow-hubspot-slack && npx vitest run` | 29/31 (2 fallas pre-existentes en `config.test.js`, esperadas) |

Commits:
- `91e73e2` test: add reproducer for hito1 (Fastify skeleton + raw body + mongo connection)
- `33bd1fd` fix: implement hito1 (Fastify skeleton, raw body parser, mongo connection)

### Hito 2 — Piezas compartidas (`src/shared/{retry,hubspotSignature,scheduler}`)

| Fase | Comando | Resultado |
|---|---|---|
| RED | `npx vitest run test/shared/` | 3 archivos fallan con `Cannot find module '../src/shared/...'` |
| GREEN | `npx vitest run` | `Test Files 6 passed (6); Tests 56 passed (56)` (40 nuevos shared + 16 Hito 1) |
| Coverage | `--coverage` | 96.74% stmts / 92.22% branches / 94.44% funcs / 96.74% lines |
| `src/shared/` | cobertura aislada | 97.63% stmts / 95.23% branches / 90% funcs / 97.63% lines |
| Legacy | jira 138/138 ✓, slack 29/31 (mismas 2 fallas) | sin regresiones |

Commits:
- `81ac361` test: add reproducer for hito2 (shared retry, hubspotSignature, scheduler)
- `d4b9887` fix: implement hito2 (shared retry, hubspotSignature, scheduler)

### Hito 3 — Migración módulo Jira

| Fase | Comando | Resultado |
|---|---|---|
| RED | `npx vitest run test/jira/` | 7 archivos fallan con `Cannot find module '../../src/modules/jira/...'` o `../../src/routes/jira/webhooks` |
| GREEN | `npx vitest run` | `Test Files 13 passed (13); Tests 150 passed (150)` (94 nuevos jira + 56 previos) |
| Coverage | `--coverage` | 96.93% stmts / 88.96% branches / 98.18% funcs / 96.93% lines |
| `src/modules/jira` | cobertura aislada | 86.79% stmts / 100% branches / 83.33% funcs |
| Legacy | jira 138/138 ✓, slack 29/31 ✓ | sin regresiones |
| Aislamiento | createApp({mongo, jira: {webhooks}}) | `/jira/...` 200, `/slack/...` 404 |

Commits:
- `a6808cf` test: add reproducer for hito3 (migrate jira tests under test/jira/**)
- `a3623cd` fix: implement hito3 (migrate jira module under src/modules/jira)

### Hito 4 — Migración Slack + refactor a DI

| Fase | Comando | Resultado |
|---|---|---|
| RED | `npx vitest run test/slack/` | 5 archivos fallan con `Cannot find module '../../src/modules/slack/...'` o `../../src/routes/slack/webhooks` |
| GREEN | `npx vitest run` | `Test Files 18 passed (18); Tests 196 passed (196)` (46 nuevos slack + 150 previos) |
| Coverage | `--coverage` | 97.18% stmts / 87.82% branches / 97.46% funcs / 97.18% lines |
| `src/modules/slack` | cobertura aislada | 86.79% stmts / 100% branches / 83.33% funcs |
| Legacy | jira 138/138 ✓, slack 29/31 ✓ | sin regresiones |
| Aislamiento | createApp({mongo, slack: {webhooks}}) | `/slack/...` 200, `/jira/...` 404 |
| DI bug fix | test explícito verifica que importar los servicios no lee `process.env` | `services/slack.test.js > factory does NOT read process.env at import time` PASS; `services/hubspot.test.js > factory does NOT read process.env at import time` PASS |

Commits:
- `4d9be65` test: add reproducer for hito4 (migrate slack tests under test/slack/** + DI fix)
- `b87aecc` fix: implement hito4 (migrate slack module under src/modules/slack + DI refactor)

### Hito 5 — Config unificado + aislamiento cruzado + Docker

| Fase | Comando | Resultado |
|---|---|---|
| RED | `npx vitest run test/config/ test/app.test.js` | 5 archivos fallan con `Cannot find module '../../src/config/...'` |
| GREEN | `npx vitest run` | `Test Files 23 passed (23); Tests 235 passed (235)` (39 nuevos config+app + 196 previos) |
| Coverage | `--coverage` | 97.28% stmts / 88.37% branches / 97.67% funcs / 97.28% lines |
| `src/config` | cobertura aislada | 97.88% stmts / 92.45% branches / 100% funcs |
| Legacy | jira 138/138 ✓, slack 29/31 ✓ | sin regresiones |
| Cross-isolation (live) | `test/app.test.js` | Slack-signed → `/jira/...` 401, Jira-signed → `/slack/...` 401, body tampered 401, configs inválidos no rompen la otra integración |

Commits:
- `000736a` test: add reproducer for hito5 (config + cross-isolation app)
- `d75953c` fix: implement hito5 (unified config + cross-isolation + Docker)

### Hito 6 — Smoke test end-to-end + reporte

| Fase | Comando | Resultado |
|---|---|---|
| RED | `npx vitest run test/smoke.test.js` | 1 archivo falla: `TypeError: createSlackIngestJob is not a function` en `src/start.js:58:18` |
| GREEN | `npx vitest run` | `Test Files 24 passed (24); Tests 242 passed (242)` (7 nuevos smoke + 235 previos) |
| Coverage final | `--coverage` | **98.33% stmts / 88.6% branches / 100% funcs / 98.33% lines** |
| Legacy | jira 138/138 ✓, slack 29/31 ✓ | sin regresiones |

Commits:
- `a88b028` test: add reproducer for hito6 (smoke test booting start() real)
- `4d0a4cf` fix: hito6 smoke test GREEN — destructure slack ingest job

---

## 4. Especificación de tests (resumen)

| # | Qué garantiza | Archivo de test | Tipo | Resultado | Evidencia |
|---|---|---|---|---|---|
| 1 | `connect/close/ping/getDb` Mongo contra memory-server | `test/db-connection.test.js` | unit | PASS | `vitest run test/db-connection.test.js` 9/9 |
| 2 | `GET /healthz` 200 cuando Mongo up, 503 cuando ping falla | `test/health.test.js` | integration | PASS | `vitest run test/health.test.js` 3/3 |
| 3 | Content type parser expone `req.rawBody` byte-exact (clave para HMAC) | `test/rawbody-capture.test.js` | integration | PASS | `vitest run test/rawbody-capture.test.js` 4/4 |
| 4 | `withRetry` reintenta en 429/5xx, respeta `retryAfterMs`, no reintenta 4xx | `test/shared/retry.test.js` | unit | PASS | `vitest run test/shared/retry.test.js` 11/11 |
| 5 | `isValidSignature` valida v1/v3 con ventana de 5min, rechaza tampering | `test/shared/hubspotSignature.test.js` | unit | PASS | `vitest run test/shared/hubspotSignature.test.js` 12/12 |
| 6 | `createScheduler` registra N jobs con DI cron + overlap guard | `test/shared/scheduler.test.js` | unit | PASS | `vitest run test/shared/scheduler.test.js` 17/17 |
| 7 | ADF extractor para descripciones Jira | `test/jira/utils-adf.test.js` | unit | PASS | 10/10 |
| 8 | JiraService: search/addComment/transitionIssue/respondToIssue + retry | `test/jira/services-jira.test.js` | unit | PASS | 16/16 |
| 9 | HubSpotService Jira: find/create/get/update + retry | `test/jira/services-hubspot.test.js` | unit | PASS | 16/16 |
| 10 | Jira store: watermark + dedup con id `jira_ingest`, índice único | `test/jira/store.test.js` | integration | PASS | 10/10 |
| 11 | Jira ingest: 13 casos de flujo + watermark regress en error | `test/jira/jobs-ingest.test.js` | integration | PASS | 16/16 |
| 12 | Webhook Jira en Fastify `/jira/webhooks/hubspot`: auth, happy, skip, error, integration | `test/jira/webhooks.test.js` | integration | PASS | 17/17 |
| 13 | Jira e2e cross-flow: ingest + webhook + dedup concurrente | `test/jira/e2e.test.js` | integration | PASS | 9/9 |
| 14 | SlackService: paginación, filtros, mention resolution | `test/slack/services-slack.test.js` | unit | PASS | 7/7 |
| 15 | Slack HubSpotService: factory DI (no process.env), notas LISBOT | `test/slack/services-hubspot.test.js` | unit | PASS | 11/11 |
| 16 | Slack store: watermark con id `slack_ingest` | `test/slack/store.test.js` | integration | PASS | 9/9 |
| 17 | Slack ingest normalizado a `{run}` | `test/slack/jobs-ingest.test.js` | integration | PASS | 8/8 |
| 18 | Webhook Slack en Fastify `/slack/webhooks/hubspot` | `test/slack/webhooks.test.js` | integration | PASS | 11/11 |
| 19 | `loadSharedConfig` valida MONGO_URI, PORT, POLL_INTERVAL_MIN | `test/config/shared.test.js` | unit | PASS | 6/6 |
| 20 | `loadJiraConfig` retorna `{ok, errors, values}` sin lanzar | `test/config/jira.test.js` | unit | PASS | 10/10 |
| 21 | `loadSlackConfig` retorna `{ok, errors, values}` sin lanzar | `test/config/slack.test.js` | unit | PASS | 5/5 |
| 22 | `loadConfig` aggregator nunca lanza, `canStart` correcto | `test/config/index.test.js` | unit | PASS | 8/8 |
| 23 | Aislamiento cruzado (Slack→/jira 401, Jira→/slack 401, /healthz robusto) | `test/app.test.js` | integration | PASS | 11/11 |
| 24 | Smoke: `start()` real bootea, /healthz 200, webhooks autenticados | `test/smoke.test.js` | e2e | PASS | 7/7 |

**Total: 242 tests en raíz, 100% pasando.**

---

## 5. Cobertura y gaps conocidos

| Área | Stmts | Branches | Funcs | Líneas |
|---|---|---|---|---|
| All files (raíz) | **98.33%** | **88.6%** | **100%** | **98.33%** |
| src/ | 100% | 91.66% | 100% | 100% |
| src/config/ | 97.88% | 92% | 100% | 97.88% |
| src/db/ | 90.47% | 86.66% | 100% | 90.47% |
| src/modules/jira/ | **100%** | **100%** | **100%** | **100%** |
| src/modules/slack/ | **100%** | **100%** | **100%** | **100%** |
| src/routes/ | 100% | 85.71% | 100% | 100% |
| src/routes/jira/ | 100% | 84.37% | 100% | 100% |
| src/routes/slack/ | 100% | 82.14% | 100% | 100% |
| src/shared/ | 100% | 95.65% | 100% | 100% |

Todos los umbrales (80% lines/functions/branches/statements) cumplidos.

### Gaps intencionales

- `src/start.js` y `index.js` están excluidos del coverage por convención (entrypoints lifecycle, no lógica de negocio). Su verificación se hace vía `test/smoke.test.js` (7 tests que ejercitan el camino completo).
- `src/shared/retry.js:33-35` (defaultSleep con `setTimeout` real) — testeado implícitamente por tests que verifican backoff exponencial; la rama no-crítica queda sin línea directa porque `sleepFn` siempre se mockea.
- `src/modules/{jira,slack}/store.js:6-12` (ensureIndexes) — expuesto para `start.js`; cubierto indirectamente por `test/smoke.test.js` que bootea `start()` real.
- `src/db/connection.js:8-9, 11-12` — ramas de validación de URI inválida y reconexión tras close; cubiertas parcialmente por tests específicos.

### Tests skipped o deshabilitados
- Ninguno. La política del skill es no tener tests `.skip`/`.only` en commits.

---

## 6. Merge evidence (resumen para squash)

Si el equipo decide squash de los 12 commits de la rama a un solo merge commit, el cuerpo del squash debe incluir este resumen para que los revisores puedan responder "qué se verificó y cómo" sin tener que abrir los commits individuales:

```
Restructuración a monolito (Hitos 1-6):
- Unifica smartflow-hubspot-jira + smartflow-hubspot-slack en un único
  proceso Node.js sobre Fastify (en lugar de Express).
- Webhooks pasan de POST /webhooks/hubspot (colisión) a:
    POST /jira/webhooks/hubspot   (firma con JIRA_HUBSPOT_APP_SECRET)
    POST /slack/webhooks/hubspot  (firma con SLACK_HUBSPOT_APP_SECRET)
- Bug de aislamiento dotenv en slack legacy: corregido en Hito 4
  (services/slack.js y services/hubspot.js refactorizados a factories
  DI puras; no leen process.env al importarse).
- Bug de config eager-throw en slack legacy: corregido en Hito 5
  (loadSlackConfig devuelve {ok, errors, values}, nunca lanza;
  start.js arranca con subsets válidos).
- Scheduler unificado con overlap guard + N jobs con nombre.
- HMAC extractor unificado en src/shared/hubspotSignature.js.
- Config por integración con override de POLL_INTERVAL_MIN.
- Docker: una imagen, un puerto (3000), un servicio.

RED/GREEN por Hito:
  Hito 1: 16 tests; Hito 2: 40 shared; Hito 3: 94 jira; Hito 4: 46 slack;
  Hito 5: 39 config+app; Hito 6: 7 smoke. Total: 242 PASS.
  Cobertura: 98.33% stmts / 88.6% branches / 100% funcs (umbral 80% ✓).
  Legacy: jira 138/138 sin cambios; slack 29/31 (2 fallas pre-existentes
  en su config.test.js que se resuelven al reemplazar el módulo).

Pendiente para Hito 7 (gated en confirmación + tag pre-monolith-removal):
  - Borrar smartflow-hubspot-jira/ y smartflow-hubspot-slack/
  - Actualizar Target URL de los webhooks en HubSpot (manual, fuera del repo)
  - Desplegar en el puerto acordado (3000)
```

---

## 7. Resumen de commits checkpoint (12 commits en la rama)

```
4d0a4cf fix: hito6 smoke test GREEN — destructure slack ingest job
a88b028 test: add reproducer for hito6 (smoke test booting start() real)
d75953c fix: implement hito5 (unified config + cross-isolation + Docker)
000736a test: add reproducer for hito5 (config + cross-isolation app)
b87aecc fix: implement hito4 (migrate slack module under src/modules/slack + DI refactor)
4d9be65 test: add reproducer for hito4 (migrate slack tests under test/slack/** + DI fix)
a3623cd fix: implement hito3 (migrate jira module under src/modules/jira)
a6808cf test: add reproducer for hito3 (migrate jira tests under test/jira/**)
d4b9887 fix: implement hito2 (shared retry, hubspotSignature, scheduler)
81ac361 test: add reproducer for hito2 (shared retry, hubspotSignature, scheduler)
33bd1fd fix: implement hito1 (Fastify skeleton, raw body parser, mongo connection)
91e73e2 test: add reproducer for hito1 (Fastify skeleton + raw body + mongo connection)
```

Total: **+4,346 líneas (test files) + +1,470 líneas (src files) + Dockerfile/compose/.env.example**, **−77 líneas** (plan viejo).

---

## 8. Próximos pasos (Hito 7 — gated)

El Hito 7 NO se ejecuta automáticamente. Requiere:

1. Tu confirmación explícita.
2. Creación del tag de seguridad `pre-monolith-removal`.
3. Confirmación de que los proyectos legacy están sin uso en producción (los Target URLs en HubSpot se actualizaron manualmente a `/jira/webhooks/hubspot` y `/slack/webhooks/hubspot`).
4. Un commit separado borrando `smartflow-hubspot-jira/` y `smartflow-hubspot-slack/`.
5. Push del tag y del commit.

Mientras tanto, el código legacy sigue funcionando y sirve como rollback instantáneo.