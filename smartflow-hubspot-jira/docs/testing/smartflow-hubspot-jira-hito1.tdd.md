# Hito 1 — Evidencia TDD (Jue: bootstrap, Mongo, healthcheck)

**Proyecto:** `smartflow-hubspot-jira`
**Rama:** `feat/hito1-bootstrap`
**Hito:** 1 de 4 (Jue)
**Stack de testing:** Vitest 2.1 + CommonJS + `mongodb-memory-server` + `supertest` (mirror del sibling `smartflow-hubspot-slack`)

## Source plan

- `docs/2026-07-08_092720-jira-hubspot-documentacion.md` (sección 12 — Plan de implementación Jue→Lun)
- `docs/testing/smartflow-hubspot-jira-hito1.tdd.md` (este archivo)
- No se proporcionó un `*.plan.md`; los user journeys se derivaron directamente del plan de implementación de la doc.

## User journeys cubiertos en este hito

1. **Como proceso Node**, cargo variables de entorno al iniciar y fallo rápido si falta una obligatoria.
2. **Como operador**, defino múltiples proyectos JIRA en una sola variable (`JIRA_PROJECT_KEY=PROJ,AUX`).
3. **Como job de ingesta**, leo y avanzo un watermark persistente que sobrevive reinicios.
4. **Como job**, garantizo que no se crea la misma task dos veces aunque el Search de HubSpot tarde en indexar.
5. **Como orquestador (Docker)**, verifico que el proceso responde y que Mongo está vivo antes de marcar healthy.

## Mapeo feature → test → evidencia

| # | Feature | RED commit | GREEN commit | Test target | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| F1 | `src/config.js` — load + validate env | `9b3822a` | `ca201ce` | `test/config.test.js` | 15/15 PASS | `npm test -- test/config.test.js` |
| F2 | `src/db/mongo.js` — watermark + processed_issues + índice único | `cc76325` | `ad8e0e2` | `test/mongo.test.js` (mongodb-memory-server) | 10/10 PASS | `npm test -- test/mongo.test.js` |
| F3 | `src/server.js` + `src/routes/health.js` + placeholder `src/routes/webhooks.js` | `32baa5d` | `cdb2956` | `test/server.test.js` (supertest) | 6/6 PASS | `npm test -- test/server.test.js` |

## Comandos ejecutados y resultados

### F1 — RED → GREEN

```bash
$ npx vitest run test/config.test.js
 Test Files  1 failed (1)
      Tests  15 failed (15)
# Causa: Cannot find module '../src/config' (RED válido)

# (implement src/config.js)

$ npm test -- test/config.test.js
 ✓ test/config.test.js (15 tests) 10ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### F2 — RED → GREEN

```bash
$ npm test -- test/mongo.test.js
 ❯ test/mongo.test.js (10 tests | 10 skipped) 2322ms
# Causa: Cannot find module '../src/db/mongo' (RED válido)

# (implement src/db/mongo.js con índice único en processed_issues)

$ npm test -- test/mongo.test.js
 ✓ test/mongo.test.js (10 tests) 3091ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### F3 — RED → GREEN

```bash
$ npm test -- test/server.test.js
# RED: routes/health y routes/webhooks no existen (suite failed, 4 tests skipped)
# (implement src/server.js + src/routes/health.js + src/routes/webhooks.js placeholder)

$ npm test -- test/server.test.js
 ✓ test/server.test.js (6 tests) 1030ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Full suite + coverage

```bash
$ npm test
 ✓ test/config.test.js (15 tests)
 ✓ test/server.test.js (6 tests)
 ✓ test/mongo.test.js (10 tests)
 Test Files  3 passed (3)
      Tests  31 passed (31)

$ npm run test:coverage
 % Coverage report from v8
--------------|---------|----------|---------|---------|----------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|----------------------
All files     |     100 |    81.57 |     100 |     100 |
 src          |     100 |      100 |     100 |     100 |
  config.js   |     100 |      100 |     100 |     100 |
 src/db       |     100 |    66.66 |     100 |     100 |
  mongo.js    |     100 |    66.66 |     100 |     100 | 11,27,32,38,49,57,64
 src/routes   |     100 |      100 |     100 |     100 |
  health.js   |     100 |      100 |     100 |     100 |
  webhooks.js |     100 |      100 |     100 |     100 |
--------------|---------|----------|---------|---------|----------------------
```

## Tabla de garantías (Test specification)

| # | Qué se garantiza | Archivo de test | Tipo | Resultado | Evidencia |
|---|---|---|---|---|---|
| 1 | Carga env válido en objeto estructurado con `JIRA_PROJECT_KEYS` como array | `test/config.test.js:loads a valid env into a structured config object` | unit | PASS | `npm test -- test/config.test.js` |
| 2 | Parsea `JIRA_PROJECT_KEY` separado por coma con trim | `test/config.test.js:parses JIRA_PROJECT_KEY as a list` | unit | PASS | idem |
| 3 | Falla con mensaje que incluye el nombre del var si falta `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` / `JIRA_PROJECT_KEY` / `HUBSPOT_TOKEN` / `WEBHOOK_SECRET` / `MONGO_URI` | `test/config.test.js:throws when * is missing` × 7 | unit | PASS | idem |
| 4 | Aplica defaults `POLL_INTERVAL_MIN=5` y `PORT=3000` | `test/config.test.js:applies default POLL_INTERVAL_MIN and PORT` | unit | PASS | idem |
| 5 | Respeta `POLL_INTERVAL_MIN` y `PORT` explícitos | `test/config.test.js:respects explicit POLL_INTERVAL_MIN and PORT` | unit | PASS | idem |
| 6 | Falla si `POLL_INTERVAL_MIN` no es entero positivo | `test/config.test.js:throws when POLL_INTERVAL_MIN is not a positive integer` | unit | PASS | idem |
| 7 | `JIRA_TRANSITION_DONE_ID` es opcional (`undefined` ausente) | `test/config.test.js:keeps JIRA_TRANSITION_DONE_ID undefined when absent` | unit | PASS | idem |
| 8 | Quita slash final de `JIRA_BASE_URL` | `test/config.test.js:strips a trailing slash from JIRA_BASE_URL` | unit | PASS | idem |
| 9 | `getWatermark()` devuelve `null` antes de cualquier `set` | `test/mongo.test.js:returns null watermark before any is set` | integration | PASS | `npm test -- test/mongo.test.js` |
| 10 | `setWatermark` + `getWatermark` round-trip | `test/mongo.test.js:sets and gets the watermark` | integration | PASS | idem |
| 11 | Segundo `setWatermark` sobrescribe | `test/mongo.test.js:overwrites the watermark on a second set` | integration | PASS | idem |
| 12 | `isProcessed` reporta `false` antes de `markProcessed`, `true` después | `test/mongo.test.js:reports an issue as not processed until marked` | integration | PASS | idem |
| 13 | Índice único `(project, issueKey)` rechaza duplicados | `test/mongo.test.js:enforces uniqueness on (project, issueKey)` | integration | PASS | idem |
| 14 | Mismo `issueKey` en proyectos distintos se trata como entradas distintas | `test/mongo.test.js:allows the same issueKey across different projects` | integration | PASS | idem |
| 15 | `__reset()` limpia ambas colecciones | `test/mongo.test.js:__reset() clears both collections` | integration | PASS | idem |
| 16 | `connect` con URI inválida lanza | `test/mongo.test.js:connect with an invalid URI throws` | integration | PASS | idem |
| 17 | `close()` sin `connect` previo no lanza | `test/mongo.test.js:close() without prior connect does not throw` | integration | PASS | idem |
| 18 | `GET /healthz` → 200 `{ ok: true, mongo: 'up' }` con Mongo up | `test/server.test.js:GET /healthz returns 200 and ok status when mongo is up` | integration | PASS | `npm test -- test/server.test.js` |
| 19 | `GET /healthz` → 503 `{ ok: false, mongo: 'down' }` con `mongo.ping` rechazado | `test/server.test.js:GET /healthz returns 503 when mongo ping throws` | integration | PASS | idem |
| 20 | `POST /webhooks/hubspot` → 501 `not implemented yet` (placeholder F9) | `test/server.test.js:POST /webhooks/hubspot returns 501` | integration | PASS | idem |
| 21 | JSON mal formado en el parser por defecto → 400 | `test/server.test.js:rejects malformed JSON with 400` | integration | PASS | idem |
| 22 | Factory de `routes/health` produce un router con `GET /healthz` | `test/server.test.js:routes/health module` | unit | PASS | idem |
| 23 | Factory de `routes/webhooks` produce un router que 501s | `test/server.test.js:routes/webhooks module` | unit | PASS | idem |

## Cobertura y gaps conocidos

- **Coverage reportada:** statements 100%, branches 81.57%, functions 100%, lines 100%.
- **Umbrales (vitest.config.js):** lines/functions/branches/statements ≥ 80%. **Cumplidos.**
- **Gaps de branch (`mongo.js` líneas 11, 27, 32, 38, 49, 57, 64):** son los guards `if (!db) throw new Error('mongo not connected')` que disparan cuando una operación se llama sin `connect()` previo. No se prueban explícitamente porque los tests siempre llaman `connect()` primero. Es una guarda defensiva — podría cubrirse en Hito 2 si surge riesgo real.
- **Excluido de cobertura:** `src/server.js` (entrypoint / wiring). Cobertura por feature: `config.js` 100%, `db/mongo.js` 100% stmt/line/func, `routes/health.js` 100%, `routes/webhooks.js` 100%.

## Estructura entregada

```
smartflow-hubspot-jira/
├── package.json
├── package-lock.json
├── vitest.config.js
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── README.md
├── docs/
│   ├── 2026-07-08_092720-jira-hubspot-documentacion.md
│   └── testing/
│       └── smartflow-hubspot-jira-hito1.tdd.md
├── src/
│   ├── server.js
│   ├── config.js
│   ├── db/
│   │   └── mongo.js
│   └── routes/
│       ├── health.js
│       └── webhooks.js   (placeholder 501; se implementa en F9)
└── test/
    ├── config.test.js
    ├── mongo.test.js
    └── server.test.js
```

## Merge evidence

Los 6 checkpoint commits están en `feat/hito1-bootstrap` (al frente de `main`). Si al final se squashean, copiar este bloque al PR body / squash commit:

| Stage | Commit | Description |
|---|---|---|
| RED F1 | `9b3822a` | test: add reproducer for config — 15/15 fallan (módulo ausente) |
| GREEN F1 | `ca201ce` | fix: load and validate env config — 15/15 PASS |
| RED F2 | `cc76325` | test: add reproducer for mongo — suite failed (módulo ausente) |
| GREEN F2 | `ad8e0e2` | fix: add mongo watermark and processed_issues with unique index — 10/10 PASS |
| RED F3 | `32baa5d` | test: add reproducer for express server — 2 fails (módulos ausentes) |
| GREEN F3 | `cdb2956` | fix: add express server with healthcheck and webhook placeholder — 6/6 PASS |

**Total: 31/31 tests passing · coverage 100/100/100/81.57% (umbrales 80% cumplidos).**
