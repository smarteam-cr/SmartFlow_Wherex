# Hito 3 — Evidencia TDD (Sáb/Dom: Flujo B + retry)

**Proyecto:** `smartflow-hubspot-jira`
**Rama:** `feat/hito1-bootstrap`
**Hito:** 3 de 4 (Sáb/Dom)
**Stack de testing:** Vitest 2.1 + CommonJS + `mongodb-memory-server` + `supertest`

## Source plan

- `docs/2026-07-08_092720-jira-hubspot-documentacion.md` (secciones 5–6 — Flujo B, dedup, auth webhook)
- `docs/testing/smartflow-hubspot-jira-hito1.tdd.md`, `…-hito2.tdd.md` (hitos previos)
- No se proporcionó `*.plan.md`.

## User journeys cubiertos en este hito

12. **Como HubSpot, al completar una task envío un webhook con token compartido** y recibo 200 rápido.
13. **Como operador, una corrida de webhook duplicada es idempotente** — `jira_listo_sent` impide re-publicar el comentario en JIRA.
14. **Como operador, si la task ya no existe o no está COMPLETED, el webhook no falla** — responde 200 con `skipped: ...` y no rompe.
15. **Como proceso, reintento llamadas HTTP transitorias** (5xx, 429) con backoff exponencial y respeto `Retry-After` cuando está presente.
16. **Como proceso, NO reintento errores de cliente** (400, 401, 403, 404) — son definitivos.
17. **Como proceso, mis servicios (JIRA, HubSpot) usan el helper de retry con un default razonable** y permiten inyectar un retry custom en tests.

## Features y mapeo → test → evidencia

| # | Feature | RED commit | GREEN commit | Test target | Resultado |
|---|---|---|---|---|---|
| F10 | `src/utils/retry.js` (`withRetry(fn, opts)`) | `6692728` | `36dee14` | `test/retry.test.js` | 10/10 PASS |
| R1 | Wrap `JiraService` y `HubSpotService` con `withRetry` (inyectable) | — | `299821f` (refactor) | `test/jira.test.js` (2 nuevos), `test/hubspot.test.js` (2 nuevos) | +4 tests |
| F9 | `src/routes/webhooks.js` handler real | `889bd21` | `21a169c` | `test/webhooks.test.js` (nuevo) | 14/14 PASS |
| W2 | Wireup en `src/server.js` (pasa `jira`/`hubspot`/`transitionDoneId` a `createWebhooksRouter`) | — | (en `21a169c`) | `test/server.test.js` (8 tests, sin regresiones) | 8/8 PASS |

## Decisión de auth del webhook

Confirmado por el usuario en la fase de planning: **"Workflow action + token en header"**. La doc menciona `X-Webhook-Signature-v3` con HMAC para Subscriptions, pero el usuario eligió el modelo más simple: token compartido en `X-Webhook-Token`. El handler:

- Compara `req.headers['x-webhook-token']` con `secret` (header configurable, default `x-webhook-token`).
- 401 si falta o no coincide.
- 200 idempotente si la task ya fue procesada.

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
 Test Files  10 passed (10)
      Tests  119 passed (119)
```

```bash
$ npm run test:coverage
 % Coverage report from v8
----------------|---------|----------|---------|---------|----------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------|---------|----------|---------|---------|----------------------
All files       |   95.97 |    84.58 |     100 |   95.97 |
 src            |     100 |      100 |     100 |     100 |
  config.js     |     100 |      100 |     100 |     100 |
  scheduler.js  |     100 |      100 |     100 |     100 |
 src/db         |     100 |    66.66 |     100 |     100 |
  mongo.js      |     100 |    66.66 |     100 |     100 | 11,27,32,38,49,57,64
 src/jobs       |   90.17 |    76.47 |     100 |   90.17 |
  ingestJira.js |   90.17 |    76.47 |     100 |   90.17 | 25-26,28-29,86-92
 src/routes     |   94.78 |       90 |     100 |   94.78 |
  health.js     |     100 |      100 |     100 |     100 |
  webhooks.js   |   93.75 |    89.18 |     100 |   93.75 | 10-11,51-54
 src/services   |   95.79 |    80.51 |     100 |   95.79 |
  hubspot.js    |   95.76 |     82.6 |     100 |   95.76 | 9,11-14
  jira.js       |   95.83 |    77.41 |     100 |   95.83 | 8,10-13
 src/utils      |   97.77 |    93.18 |     100 |   97.77 |
  adf.js        |     100 |    94.11 |     100 |     100 | 12
  retry.js      |      95 |    92.59 |     100 |      95 | 14-15
----------------|---------|----------|---------|---------|----------------------
```

## Tabla de garantías (Test specification)

| # | Qué se garantiza | Archivo de test | Tipo | Resultado | Evidencia |
|---|---|---|---|---|---|
| 58 | `withRetry` retorna valor en éxito sin dormir | `test/retry.test.js:returns the resolved value on first success` | unit | PASS | `npm test -- test/retry.test.js` |
| 59 | `withRetry` reintenta 5xx con backoff exponencial (base*2^attempt) y lanza al agotar | `test/retry.test.js:retries on retryable status (5xx)` | unit | PASS | idem |
| 60 | `withRetry` reintenta 429 respetando `retryAfterMs` cuando está presente | `test/retry.test.js:retries on 429 and respects retryAfterMs` | unit | PASS | idem |
| 61 | `withRetry` usa backoff normal para 429 sin `retryAfterMs` | `test/retry.test.js:falls back to exponential backoff for 429` | unit | PASS | idem |
| 62 | `withRetry` NO reintenta 4xx (excepto 429) | `test/retry.test.js:does NOT retry on 4xx` × 4 | unit | PASS | idem |
| 63 | `withRetry` trata errores de red (sin `.status`) como retryable | `test/retry.test.js:treats network errors as retryable` | unit | PASS | idem |
| 64 | `withRetry` permite `isRetryable` custom (puede marcar 408 como retryable) | `test/retry.test.js:respects isRetryable when provided` | unit | PASS | idem |
| 65 | `withRetry` pasa el `attempt` index al fn envuelto | `test/retry.test.js:passes the attempt index` | unit | PASS | idem |
| 66 | `JiraService` reintenta 503 por default (real withRetry) | `test/jira.test.js:retries on 503 then succeeds` | unit | PASS | `npm test -- test/jira.test.js` |
| 67 | `JiraService` NO reintenta 400 por default | `test/jira.test.js:does not retry on 400` | unit | PASS | idem |
| 68 | `HubSpotService` reintenta 503 por default | `test/hubspot.test.js:retries on 503 then succeeds` | unit | PASS | `npm test -- test/hubspot.test.js` |
| 69 | `HubSpotService` NO reintenta 400 por default | `test/hubspot.test.js:does not retry on 400` | unit | PASS | idem |
| 70 | Webhook 401 si header de token falta o es incorrecto | `test/webhooks.test.js:returns 401 when the token header is missing` × 2 | integration | PASS | `npm test -- test/webhooks.test.js` |
| 71 | Webhook 400 si el body no trae `objectId`/`taskId` | `test/webhooks.test.js:returns 400 when the body has no extractable taskId` | integration | PASS | idem |
| 72 | Webhook extrae `objectId` y `taskId` (ambos formatos) | `test/webhooks.test.js:accepts objectId` × 2 | integration | PASS | idem |
| 73 | Webhook happy path: `respondToIssue` + `updateTask` con `jira_listo_sent='true'` y `jira_comment_id` | `test/webhooks.test.js:calls respondToIssue, updates the task` | integration | PASS | idem |
| 74 | Webhook `transitionDoneId` se pasa desde la config al service | `test/webhooks.test.js:passes undefined transitionDoneId when not configured` | integration | PASS | idem |
| 75 | Webhook 200 `{skipped:'gone'}` cuando la task devuelve 404 en HubSpot | `test/webhooks.test.js:returns 200 skipped:gone` | integration | PASS | idem |
| 76 | Webhook 200 `{skipped:'not_done'}` cuando `hs_task_status != 'COMPLETED'` | `test/webhooks.test.js:returns 200 skipped:not_done` | integration | PASS | idem |
| 77 | Webhook 200 `{skipped:'no_key'}` cuando `jira_issue_key` falta en la task | `test/webhooks.test.js:returns 200 skipped:no_key` | integration | PASS | idem |
| 78 | Webhook 200 `{skipped:'duplicate'}` cuando `jira_listo_sent='true'` (idempotencia) | `test/webhooks.test.js:returns 200 skipped:duplicate` | integration | PASS | idem |
| 79 | Webhook 500 si `jira.respondToIssue` lanza (HubSpot reintenta) | `test/webhooks.test.js:returns 500 when jira.respondToIssue throws` | integration | PASS | idem |
| 80 | Webhook 500 si `hubspot.updateTask` lanza (HubSpot reintenta) | `test/webhooks.test.js:returns 500 when hubspot.updateTask throws` | integration | PASS | idem |
| 81 | `createWebhooksRouter` requiere `secret`, `jira`, `hubspot` | `test/server.test.js:throws when * is missing` × 3 | unit | PASS | `npm test -- test/server.test.js` |

## Cobertura y gaps conocidos

- **Coverage reportada:** statements 95.97%, branches 84.58%, functions 100%, lines 95.97%.
- **Umbrales (80%):** **cumplidos.**
- **Gaps por archivo (código defensivo, no afecta comportamiento):**
  - `src/utils/retry.js` 14–15: throw cuando `retries` no es entero no-negativo (validación).
  - `src/services/jira.js` 8, 10–13: throws del factory (`baseUrl`/`email`/`apiToken` requeridos).
  - `src/services/hubspot.js` 9, 11–14: throws del factory (`token` requerido).
  - `src/routes/webhooks.js` 10–11: throws del factory (deps requeridos). 51–54: path de error genérico de `getTask` que NO es 404.
  - `src/jobs/ingestJira.js` 25–26, 28–29: throws del factory del job. 86–92: catch de `markProcessed` por duplicado.
  - `src/db/mongo.js` 11, 27, 32, 38, 49, 57, 64: guards `if (!db) throw 'mongo not connected'`.
  - `src/utils/adf.js` 12: `if (!adf) return ''` cuando el argumento es string vacío (solo se cubre con `null`/`undefined`).

## Estructura entregada en este hito

```
smartflow-hubspot-jira/src/
├── routes/
│   └── webhooks.js          (F9 — handler real, sustituye el placeholder 501)
├── utils/
│   └── retry.js             (F10 — withRetry genérico + isRetryableDefault)
└── services/                (refactor R1: envueltos con withRetry inyectable)
    ├── hubspot.js
    └── jira.js

smartflow-hubspot-jira/test/
├── retry.test.js            (nuevo, 10 tests)
├── webhooks.test.js         (nuevo, 14 tests)
└── (server.test.js, hubspot.test.js, jira.test.js: actualizados)
```

## Decisiones de diseño relevantes

1. **`withRetry` inyectable en los servicios.** Los servicios aceptan un `withRetry` opcional. Los tests pasan un `(fn) => fn()` no-op para que los tests de "throws on 500" sean rápidos. Los tests de retry usan el default real. Esto evita los ~1.4s de sleep por test.
2. **Idempotencia con `jira_listo_sent='true'` (string).** HubSpot trata boolean y string distinto, pero la doc dice "string". Comparamos con string `=== 'true'`. Es la forma más segura para evitar que un reintento de HubSpot cree comentarios duplicados en JIRA.
3. **404 de HubSpot → 200 con `skipped: 'gone'`.** Si el operador borró la task manualmente, no queremos que HubSpot reintente eternamente. Devolvemos 200 con un código semántico para logs/observabilidad.
4. **500 en errores de JIRA o HubSpot.** A diferencia de los "skipped" paths, los errores reales (500, 502, etc.) devuelven 500 al webhook para que HubSpot reintente (política de Webhook Subscriptions).
5. **`extractTaskId` helper.** Soporta `body.objectId` (Subscriptions), `body.taskId` (custom) y `body.properties.hs_object_id` (workflow con propiedades). El más común es `objectId`.
6. **Header configurable.** `headerName` es un parámetro, default `x-webhook-token`. Esto permite ajustar al header que use HubSpot en la acción "Send a webhook".
7. **Retry-aware con `Retry-After`.** El `parseRetryAfterMs` parsea el header `Retry-After` tanto en formato `delta-seconds` como HTTP-date. Si está presente, el delay lo respeta; si no, backoff exponencial.

## Pendientes para Hito 4 (F11, F12)

- **F11 — E2E integration** (`test/e2e.test.js`):
  - Ejecuta `ingest.run()` con fixtures → asserts en `processed_issues` y en `fetch.mock.calls` a HubSpot.
  - Ejecuta `POST /webhooks/hubspot` con firma válida + task `COMPLETED` → comentario JIRA creado + `updateTask` con `jira_listo_sent=true`.
  - Segundo webhook con misma task ya marcada → skip "duplicate", 0 calls extra a JIRA.
  - Solape de corrida (issues repetidos en 2 ingestas) → 0 tasks duplicadas (índice Mongo).
- **F12 — Deploy artifacts:** `Dockerfile` ya tiene healthcheck. Validar `docker build` con un test mínimo de smoke.

## Merge evidence

| Stage | Commit | Description |
|---|---|---|
| RED F10 | `6692728` | test: add reproducer for retry helper — 10 tests fail (módulo ausente) |
| GREEN F10 | `36dee14` | fix: add withRetry helper with exponential backoff and retry-after — 10/10 PASS |
| R1 refactor | `299821f` | refactor: wrap jira and hubspot with withRetry (injected, defaults to real) — +4 tests, sin regresiones |
| RED F9 | `889bd21` | test: add reproducer for webhooks route and remove placeholder test — 14 tests fail (módulo aún placeholder) |
| GREEN F9 | `21a169c` | fix: add hubspot webhook handler with token auth and idempotency — 14/14 PASS; server.test.js actualizado |

**Total: 119/119 tests passing · coverage 95.97 / 84.58 / 100 / 95.97 % (umbrales 80% cumplidos).**
