# TDD Evidence — Compartir MongoDB entre smartflow-hubspot-jira y smartflow-hubspot-slack

## Source plan

[`docs/2026-07-09_plan-compartir-mongodb-jira-slack.md`](../../2026-07-09_plan-compartir-mongodb-jira-slack.md)

## User journeys (derividas del plan)

1. **Como operador del servidor**, quiero que tanto `smartflow-hubspot-jira`
   como `smartflow-hubspot-slack` apunten a la misma instancia de MongoDB
   (`WherEXdb`), para mantener una sola instancia de Mongo en el servidor.
2. **Como desarrollador**, al hacer `docker compose up -d` en jira, no quiero
   que se levante un contenedor `mongo` propio que choque con la instancia
   compartida del servidor.
3. **Como desarrollador nuevo**, al copiar `.env.example` a `.env`, quiero
   que el `MONGO_URI` sugerido apunte a `WherEXdb` (la DB compartida), no a
   una DB por proyecto.
4. **Como futuro mantenedor**, quiero que ambos READMEs documenten que la
   base es compartida y qué colecciones pertenecen a cada app, para no asumir
   aislamiento total al intervenir en Mongo.

## Task report

### smartflow-hubspot-jira

| Tarea plan | Resumen ejecución | Comando verificación | Salida / evidencia | Garantía |
|---|---|---|---|---|
| 1a. Quitar servicio `mongo` + volumen `mongo_data` + `depends_on` + bloque `environment.MONGO_URI` de `docker-compose.yml` | Reescrito el compose a `app` + `env_file` + `restart` | `docker compose config -q` | `jira compose OK`; `docker compose config \| grep MONGO_URI` → `MONGO_URI: mongodb://localhost:27017/WherEXdb`; no aparece ningún bloque `mongo:` | El compose ya no arranca Mongo propio; el `MONGO_URI` viene 100% del `.env` |
| 1b. `.env.example`: cambiar `jira_hubspot` → `WherEXdb` | Editada línea 24 | inspección `cat .env.example` | `MONGO_URI=mongodb://localhost:27017/WherEXdb` | Nuevos devs configuran la DB compartida correcta |
| 1c. `.env` (local, no versionado): mismo cambio | Editada línea 23 | inspección (gitignored, no aparece en `git status`) | `MONGO_URI=mongodb://localhost:27017/WherEXdb` | Desarrollo local apunta a DB compartida |
| 1d. `README.md`: fila `MONGO_URI` (L52) | Editada fila tabla env vars | inspección | Texto actualizado menciona `WherEXdb` y la nota compartida | Documentación sincronizada |
| 1e. `README.md`: sección "Deploy con Docker" (L126-137) | Reescrita la sección | inspección | Dice "no levanta su propio MongoDB" + instrucciones para apuntar a instancia externa | Pasos de deploy reflejan la nueva arquitectura |
| 1f. `README.md`: nueva sección "Base de datos compartida" | Agregada después de Configuración | inspección | Tabla con colecciones + `_id` de watermark por app + comando `docker run shared-mongo` | Mantenedores futuros ven la convención |
| 1g. `docs/2026-07-08_092720-jira-hubspot-documentacion.md` L323 | Editada | `grep "WherEXdb" docs/2026-07-08_092720-jira-hubspot-documentacion.md` | match en línea 323 | Sin drift entre doc histórica y código |
| 1h. Validación que no haya regresión de tests | `npm test` | `npm test 2>&1 \| tail` | `Test Files 12 passed (12) / Tests 138 passed (138)` | Suite completa sigue verde |

### smartflow-hubspot-slack

| Tarea plan | Resumen ejecución | Comando verificación | Salida / evidencia | Garantía |
|---|---|---|---|---|
| 2a. Quitar bloque `environment.MONGO_URI` de `docker-compose.yml` | Editado para dejar `app` + `env_file` + `restart` | `docker compose config -q` | `slack compose OK`; `grep MONGO_URI` → `mongodb://localhost:27017/WherEXdb` (antes era `mongodb://mongo:27017/slack_hubspot`) | El `MONGO_URI` viene del `.env`, no está hardcodeado |
| 2b. `.env.example`: `slack_hubspot` → `WherEXdb` | Editada línea 19 | inspección | `MONGO_URI=mongodb://localhost:27017/WherEXdb` | Nuevos devs configuran la DB compartida correcta |
| 2c. `.env` (local, no versionado): mismo cambio | Editada línea 23 | inspección (gitignored) | `MONGO_URI=mongodb://localhost:27017/WherEXdb` | Desarrollo local apunta a DB compartida |
| 2d. `README.md` ejemplo dotenv (L60) | Editada | inspección | URI ya es `WherEXdb` | Sin drift |
| 2e. `README.md`: quitar paso `docker compose up -d mongo` (L81-84) | Reemplazado por `docker run -d --name shared-mongo -p 27017:27017 -v shared_mongo_data:/data/db mongo:7` | inspección | README ya no dice "levantar mongo embebido" | Instrucciones de setup local correctas |
| 2f. `README.md`: quitar nota de sobreescritura interna (L103) | Reescrito el párrafo | inspección | Ahora dice "MONGO_URI se toma del env_file" | Sin instrucciones obsoletas |
| 2g. `README.md`: nueva sección "Base de datos compartida" | Agregada después de "Con Docker Compose completo" | inspección | Misma tabla y comando `shared-mongo` | Mantenedores futuros ven la convención |
| 2h. `docs/documentacion-slack-hubspot.md` L259 | Editada | `grep "WherEXdb" docs/documentacion-slack-hubspot.md` | match en línea 259 | Sin drift entre doc histórica y código |
| 2i. Validación que no haya regresión de tests | `npm test` | `npm test 2>&1 \| tail` | `Test Files 1 failed \| 6 passed (7) / Tests 2 failed \| 29 passed (31)` — **los mismos 2 fallos del baseline, sin regresión** | Sin nueva regresión introducida |

## Test specification

| # | Qué se garantiza | Archivo o comando | Tipo | Resultado | Evidencia |
|---|---|---|---|---|---|
| 1 | `smartflow-hubspot-jira/docker-compose.yml` no define servicio `mongo` propio | `cd smartflow-hubspot-jira && docker compose config \| grep "^  mongo:"` debe devolver vacío | integration | PASS | `grep` vacío en post-cambio |
| 2 | `smartflow-hubspot-jira/docker-compose.yml` no define volumen `mongo_data` | `grep mongo_data: smartflow-hubspot-jira/docker-compose.yml` debe devolver vacío | integration | PASS | Vacío |
| 3 | `smartflow-hubspot-jira/docker-compose.yml` no hardcodea `MONGO_URI` en `environment` | el archivo no contiene `MONGO_URI:` en su `environment:` | integration | PASS | Inspección confirma |
| 4 | `MONGO_URI` efectivo en jira = `mongodb://localhost:27017/WherEXdb` (viene del `.env`) | `cd smartflow-hubspot-jira && docker compose config \| grep MONGO_URI` | integration | PASS | `MONGO_URI: mongodb://localhost:27017/WherEXdb` |
| 5 | `smartflow-hubspot-jira/.env.example` apunta a `WherEXdb` | `grep "MONGO_URI=" smartflow-hubspot-jira/.env.example` | unit (config) | PASS | `MONGO_URI=mongodb://localhost:27017/WherEXdb` |
| 6 | `smartflow-hubspot-slack/docker-compose.yml` no hardcodea `MONGO_URI` en `environment` | el archivo no contiene `MONGO_URI:` en su `environment:` | integration | PASS | Inspección confirma |
| 7 | `MONGO_URI` efectivo en slack = `mongodb://localhost:27017/WherEXdb` (viene del `.env`) | `cd smartflow-hubspot-slack && docker compose config \| grep MONGO_URI` | integration | PASS | `MONGO_URI: mongodb://localhost:27017/WherEXdb` |
| 8 | `smartflow-hubspot-slack/.env.example` apunta a `WherEXdb` | `grep "MONGO_URI=" smartflow-hubspot-slack/.env.example` | unit (config) | PASS | `MONGO_URI=mongodb://localhost:27017/WherEXdb` |
| 9 | Ambos READMEs mencionan `WherEXdb` y documentan la DB compartida | `grep "WherEXdb" smartflow-hubspot-{jira,slack}/README.md` | unit (docs) | PASS | 5 matches en cada uno |
| 10 | jira: suite completa de tests sigue verde tras los cambios | `cd smartflow-hubspot-jira && npm test` | unit + integration + E2E | PASS | `138 passed (138)` |
| 11 | slack: tests no introducen nueva regresión | `cd smartflow-hubspot-slack && npm test` | unit + integration | PASS (con 2 fallos pre-existentes, fuera de scope) | `2 failed \| 29 passed` — idéntico al baseline |

## Coverage y gaps conocidos

- **Cobertura de código**: este cambio es de configuración (`docker-compose.yml`,
  `.env.example`, `.env`) y documentación (`README.md`, `docs/*.md`)**. No toca
  código de runtime (`src/**`), por lo que las métricas de cobertura del
  proyecto quedan inalteradas:
  - jira: 138/138 tests PASS (igual al baseline).
  - slack: 29/31 tests PASS (igual al baseline; las 2 fallas son pre-existentes).
- **Gaps intencionales**:
  - **Test smoke manual con mongosh** (sección "Verificación" del plan, paso 3):
    requiere instancia externa de Mongo real, fuera del alcance de este entorno
    CI local. Queda como validación manual en despliegue.
  - **`test/mongo.test.js`** mantiene `test_jira_hubspot` / `test_slack_hubspot`
    como segundo arg de `mongo.connect()`: son **nombres de DB de aislamiento de
    tests** dentro de `mongodb-memory-server`, no la DB real. Se dejan
    intencionalmente sin tocar (decisión documentada en el plan).
- **Fallo pre-existente NO relacionado al plan** (mencionado para trazabilidad,
  NO introducido por este cambio):
  - `smartflow-hubspot-slack/test/config.test.js`:
    - `throws when a required env var is missing`
    - `applies default POLL_INTERVAL_MIN and PORT`
  - Causa raíz: `smartflow-hubspot-slack/src/config.js` línea 1 invoca
    `require('dotenv').config()` a nivel de módulo, lo cual recarga el `.env`
    real dentro de `process.env` **después** de que el test haya hecho
    `clearEnv() + setEnv()`. Diseño divergente del repo jira (que carga dotenv
    desde `src/server.js` y no desde config). Queda como issue separado, fuera
    del alcance de este plan.

## Notas de handoff

- `.env` de ambos repos está en `.gitignore` (línea 3 de cada `.gitignore`).
  Los cambios a `.env` quedan sólo en disco local, intencionalmente no se
  commitean.
- Los archivos modificados son exactamente 8 (4 por repo). Verificable con
  `git status` desde la raíz del monorepo.
- `docs/` (que contiene el plan) sigue sin trackear en git. Si se quiere
  versionar el plan, agregarlo explícitamente con `git add docs/`.
