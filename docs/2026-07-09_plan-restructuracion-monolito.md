# Plan: unificar smartflow-hubspot-jira + smartflow-hubspot-slack en un solo servicio

## Contexto

Hoy `SmartFlow_Wherex` es un contenedor de dos proyectos Node.js **totalmente independientes**: `smartflow-hubspot-jira` (puerto 3000) y `smartflow-hubspot-slack` (puerto 3006), cada uno con su propio `package.json`, `Dockerfile`, `docker-compose.yml` y proceso. El único punto que ya comparten es MongoDB (`WherEXdb`, unificado en el commit `d59b999` sin tocar código, solo config).

El problema que motiva este cambio: para desplegar en un único VPS, cada integración necesita su propio webhook expuesto (`POST /webhooks/hubspot` en ambos, hoy en procesos/puertos distintos). Si se corren como un solo proceso sin diferenciarlos, **las rutas de los webhooks colisionan** — ambos escuchan literalmente el mismo path. La solución es fusionar ambos proyectos en un solo proceso con un entry point único, donde cada integración tiene su propio namespace de rutas (`/jira/...`, `/slack/...`) y comparte infraestructura común (Mongo, config, utilidades).

Investigación previa (exploración de código + verificación directa de archivos) confirmó que:
- Ambos proyectos son estructuralmente casi idénticos (`config.js`, `server.js`, `scheduler.js`, `db/mongo.js`, `jobs/ingest*.js`, `routes/webhooks.js`, `services/*.js`), con las mismas dependencias en versiones casi idénticas.
- La verificación HMAC de firma de HubSpot (`isValidSignature`) es **código idéntico byte a byte** copiado entre ambos `routes/webhooks.js` — candidato directo a extraer como módulo compartido.
- `smartflow-hubspot-slack/src/services/hubspot.js` lee `process.env.HUBSPOT_TOKEN`/`HS_PIPELINE_ID`/etc. directamente dentro de sus funciones (no es una factory DI como su equivalente en jira) — necesita un refactor, no solo un movimiento de archivo.
- `smartflow-hubspot-slack/src/config.js` hace `require('dotenv').config()` en la línea 1 y valida de forma "eager" (lanza excepción al hacer `require()` si falta una variable) — esto ya causa un bug de aislamiento de tests documentado, y sería fatal en un proceso unificado (un env var faltante de Slack tumbaría también a Jira).
- Existe un bug latente ya presente hoy: el `.env.example` de slack trae `PORT=3000` pero su `docker-compose.yml` mapea `3006:3006`. Pasar a un solo puerto/proceso elimina esta clase de error.

**Decisiones confirmadas:**
1. Las credenciales de HubSpot (`HUBSPOT_TOKEN`/`HUBSPOT_APP_SECRET`) son de **apps distintas** para Jira y Slack → se namespacean por integración en el `.env` unificado.
2. Migración **por etapas (Hitos)**, no big-bang: se arma el esqueleto nuevo junto a los proyectos actuales (que siguen funcionando sin tocar), se migra un módulo a la vez verificando tests en cada paso, y las carpetas viejas se retiran solo al final, en un commit aparte y con confirmación explícita.
3. Ejecución **etapa por etapa**: se implementa un Hito, se corren los tests, se revisa el resultado, y se espera aprobación antes de seguir con el siguiente.
4. El framework HTTP del proceso unificado es **Fastify**, no Express (los dos proyectos actuales usan Express 4). Esto es más que un cambio de nombre: `app.js` y ambos `routes/*/webhooks.js` se **reescriben** (no se mueven tal cual), porque Fastify usa una firma de handler distinta (`(request, reply)` en vez de `(req, res)`) y un mecanismo distinto para capturar el raw body que necesita la verificación HMAC (ver sección dedicada más abajo). Esto amplía un poco el alcance de los Hitos 1, 3 y 4 frente a un simple traslado de archivos. El resto del código (`services/`, `jobs/`, `db/`, `scheduler`, `utils/`) no toca el framework HTTP para nada, así que no se ve afectado.

---

## Estructura objetivo

```
SmartFlow_Wherex/
├── index.js                        # NUEVO — único entry point del proceso
├── package.json                    # NUEVO — raíz, reemplaza los dos package.json actuales (fastify en vez de express)
├── vitest.config.js                # NUEVO — raíz, umbral de cobertura 80% (como jira hoy)
├── Dockerfile                      # NUEVO — una sola imagen
├── docker-compose.yml              # NUEVO — un solo servicio "app", un puerto
├── .env.example / .env             # NUEVO — unificado y namespaceado (ver abajo)
├── README.md                       # REESCRITO (ya no "dos proyectos independientes")
├── docs/
│   ├── 2026-07-09_plan-restructuracion-monolito.md      # este documento
│   └── testing/2026-07-09-restructuracion-monolito.tdd.md  # evidencia final (Hito 6)
├── src/
│   ├── app.js                      # createApp() — instancia Fastify, registra todos los plugins/rutas
│   ├── start.js                    # start() — conecta Mongo una vez, arma módulos, arranca scheduler, listen(), shutdown
│   ├── config/
│   │   ├── index.js                 # agrega shared+jira+slack, NO lanza excepciones
│   │   ├── shared.js                # PORT, MONGO_URI, POLL_INTERVAL_MIN (fallback)
│   │   ├── jira.js                  # loadJiraConfig(env) — función pura, {ok, values|errors}
│   │   └── slack.js                 # loadSlackConfig(env) — mismo contrato
│   ├── db/
│   │   └── connection.js            # conexión Mongo compartida: connect/close/ping/getDb (basado en el mongo.js de jira, es el más defensivo)
│   ├── modules/
│   │   ├── jira/
│   │   │   ├── services/{jira.js, hubspot.js}   # ← movidos tal cual (ya son factories DI)
│   │   │   ├── jobs/ingest.js                   # ← ingestJira.js
│   │   │   ├── utils/adf.js                     # ← utils/adf.js (solo-jira, no se comparte)
│   │   │   └── store.js                         # ← porción watermark/dedup de db/mongo.js (processed_issues, watermark 'jira_ingest')
│   │   └── slack/
│   │       ├── services/{slack.js, hubspot.js}  # ← REFACTOR a factories DI explícitas (hoy leen process.env directo)
│   │       ├── jobs/ingest.js                   # ← ingestSlack.js, normalizado a retornar {run} igual que jira
│   │       └── store.js                         # ← porción watermark/dedup (processed_messages, watermark 'slack_ingest')
│   ├── routes/
│   │   ├── health.js                # GET /healthz único (plugin Fastify) — reemplaza jira's /healthz Y slack's /health
│   │   ├── jira/webhooks.js         # REESCRITO como plugin Fastify a partir de routes/webhooks.js de jira, prefix /jira/webhooks/hubspot
│   │   └── slack/webhooks.js        # REESCRITO como plugin Fastify a partir de routes/webhooks.js de slack, prefix /slack/webhooks/hubspot
│   └── shared/
│       ├── hubspotSignature.js      # NUEVO — isValidSignature() extraída (hoy duplicada byte-a-byte)
│       ├── retry.js                 # ← utils/retry.js de jira (verbatim)
│       └── scheduler.js             # NUEVO — cron unificado: DI de jira + guard de solapamiento de slack + N jobs con nombre
├── scripts/{jira,slack}/setup-hubspot-properties.js
├── bin/jira/{run-once,list-jira-transitions,list-hubspot-ticket-stages}.js
├── test/
│   ├── app.test.js                  # NUEVO — aislamiento cruzado entre integraciones (ver "Verificación")
│   ├── shared/{db,hubspotSignature,retry,scheduler}.test.js
│   ├── jira/**                      # ← test/ de jira, reorganizado por submódulo
│   └── slack/**                     # ← test/ de slack, reorganizado + reescrito donde slack pasa a DI
├── smartflow-hubspot-jira/          # SIN TOCAR hasta el Hito final confirmado
└── smartflow-hubspot-slack/         # SIN TOCAR hasta el Hito final confirmado
```

**Nota sobre el boceto original:** se dibujó `.env` dentro de `src/`. Se deja en la raíz del repo (junto a `index.js`), igual que hoy en ambos proyectos, porque `dotenv.config()` resuelve relativo a `process.cwd()`, el `env_file:` de docker-compose resuelve relativo a la raíz, y el `.gitignore` ya está escrito asumiendo esa ubicación. El resto del boceto (index.js → src/modules/{Jira,Slack} como ramas hermanas, routes/ separado de modules/ pero dependiendo de él) se respeta tal cual — de hecho ya es el patrón que usan ambos proyectos hoy (los routers reciben los servicios ya construidos por parámetro, no los instancian ellos mismos), así que es un traslado de bajo riesgo, no una reescritura.

## Rutas de los webhooks

| Hoy | Nuevo |
|---|---|
| `POST /webhooks/hubspot` (jira, puerto 3000) | `POST /jira/webhooks/hubspot` |
| `POST /webhooks/hubspot` (slack, puerto 3006) | `POST /slack/webhooks/hubspot` |
| `GET /healthz` (solo jira, pinga Mongo) | `GET /healthz` (único, pinga Mongo, ahora cubre todo el proceso) |
| `GET /health` (solo slack, sin pinga Mongo) | se retira (reemplazado por `/healthz`) |

**Paso manual fuera del repo (importante):** en HubSpot, cada app privada tiene configurada su "Target URL" de webhook apuntando a `.../webhooks/hubspot`. Hay que actualizarlas a `.../jira/webhooks/hubspot` y `.../slack/webhooks/hubspot` respectivamente cuando se haga el corte (Hito 6) — esto no se puede scriptear desde el repo, y conviene dejar los procesos viejos disponibles como rollback mientras se confirma que las nuevas URLs reciben eventos.

### Captura de raw body para HMAC bajo Fastify

Hoy, en Express, `express.json({ verify: (req, res, buf) => { req.rawBody = buf } })` captura los bytes crudos del body antes de parsearlos — imprescindible porque la firma HMAC de HubSpot se calcula sobre el body tal cual llegó, no sobre una versión re-serializada. Fastify no tiene un `verify` equivalente en su parser por defecto, así que el Hito 1 agrega un `addContentTypeParser` propio que hace lo mismo:

```js
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body; // Buffer crudo, igual que req.rawBody en Express hoy
  try {
    done(null, body.length ? JSON.parse(body) : {});
  } catch (err) {
    done(err);
  }
});
```

Con esto, `src/shared/hubspotSignature.js` (la función `isValidSignature`) no cambia ni una línea — ya recibe `rawBody` como string plano por parámetro, es agnóstica al framework (confirmado leyendo el código actual). Solo cambia *quién* se lo pasa: los plugins Fastify usan `request.rawBody.toString('utf8')` en vez de `req.rawBody.toString('utf8')`, y leen headers de `request.headers['x-hubspot-signature-v3']` en vez de `req.get('x-hubspot-signature-v3')` (Fastify no tiene `.get()`, expone `headers` como objeto plano ya en minúsculas).

## Config y variables de entorno

`src/config/jira.js` y `src/config/slack.js` siguen el patrón que ya existe parcialmente en jira (`loadConfig(env)` como función pura) pero **nunca lanzan excepción**: devuelven `{ok: true, values}` o `{ok: false, errors}`. `src/start.js` monta las rutas y el cron job de una integración solo si su config resolvió `ok: true`; si ninguna de las dos tiene config válida, ahí sí se niega a arrancar. Esto corrige el problema de hoy donde una variable faltante de Slack tumbaría también a Jira. `dotenv.config()` se llama **una sola vez**, al tope de `index.js` — esto de paso corrige el bug de aislamiento de tests que hoy tiene `smartflow-hubspot-slack/src/config.js` (carga dotenv de nuevo dentro de config.js, pisando el entorno que los tests configuran a mano).

`.env.example` unificado (con credenciales de HubSpot namespaceadas por integración):

```
# --- Compartido ---
PORT=3000
MONGO_URI=mongodb://localhost:27017/WherEXdb
POLL_INTERVAL_MIN=5                     # fallback si no se define por integración

# --- Integración Jira ---
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_PROJECT_KEY=
JIRA_TRANSITION_DONE_ID=
JIRA_POLL_INTERVAL_MIN=                 # opcional, override del fallback
JIRA_HUBSPOT_TOKEN=                     # antes HUBSPOT_TOKEN
JIRA_HUBSPOT_APP_SECRET=                # antes HUBSPOT_APP_SECRET
JIRA_HUBSPOT_PIPELINE_ID=               # antes HUBSPOT_TICKET_PIPELINE_ID
JIRA_HUBSPOT_STAGE_NEW_ID=              # antes HUBSPOT_TICKET_STAGE_NEW_ID
JIRA_HUBSPOT_STAGE_CLOSED_ID=           # antes HUBSPOT_TICKET_STAGE_CLOSED_ID

# --- Integración Slack ---
SLACK_BOT_TOKEN=
SLACK_CHANNEL_ID=
SLACK_POLL_INTERVAL_MIN=                # opcional, override del fallback
SLACK_HUBSPOT_TOKEN=                    # antes HUBSPOT_TOKEN
SLACK_HUBSPOT_APP_SECRET=               # antes HUBSPOT_APP_SECRET
SLACK_HUBSPOT_PIPELINE_ID=              # antes HS_PIPELINE_ID
SLACK_HUBSPOT_STAGE_NEW_ID=             # antes HS_STAGE_NEW_ID
SLACK_HUBSPOT_STAGE_COMPLETED_ID=       # antes HS_STAGE_COMPLETED_ID
```

`PORT` pasa de dos valores (3000/3006) a uno solo (3000 por defecto, overrideable).

## Qué se unifica de verdad vs. qué se mantiene namespaceado

| Pieza | Veredicto |
|---|---|
| Conexión Mongo (`connect`/`close`/`ping`) | **Unificar** en `src/db/connection.js`, basado en la versión de jira (más defensiva: guards, resetea en `close()`, tiene `ping()`) |
| Watermark/dedup (`processed_issues` vs `processed_messages`) | **Mantener separado**, `store.js` por módulo — colecciones y claves distintas, unificarlas de más añade abstracción sin necesidad real |
| `utils/retry.js` | **Unificar** en `src/shared/retry.js`, verbatim de jira. Slack no lo consume hoy (sus clientes no tienen retry) — no se le agrega como parte de esta migración, queda como mejora futura aparte |
| `isValidSignature` (HMAC HubSpot) | **Unificar** en `src/shared/hubspotSignature.js` — confirmado idéntico byte a byte en ambos `routes/webhooks.js` actuales |
| Scheduler | **Unificar** en `src/shared/scheduler.js` — combina el DI/stop de jira con el guard de solapamiento de slack, registra los jobs que sí tengan config válida |
| `services/hubspot.js` (jira y slack) | **Mantener separados** — construyen propiedades de ticket distintas (`jira_issue_key...` vs `slack_message_ts...`) y slack tiene lógica extra (notas de reapertura) que jira no tiene. Forzar una abstracción común es un proyecto aparte, no parte de este |
| `utils/adf.js` | Se queda solo en `modules/jira/` — no tiene equivalente en slack |

## Hitos de migración

| Hito | Alcance | Criterio de salida |
|---|---|---|
| **0** | Formalizar este plan en `docs/2026-07-09_plan-restructuracion-monolito.md`. Sin código. | Este documento |
| **1** | Esqueleto raíz con **Fastify**: `package.json` (fastify en vez de express), `vitest.config.js`, `index.js` mínimo, el `addContentTypeParser` de raw body, `src/db/connection.js`, `src/routes/health.js`. Proyectos viejos sin tocar. | `npm test` en raíz pasa (health + connection + un test que confirma que `request.rawBody` llega intacto). Los dos proyectos viejos siguen pasando sus tests sin modificar |
| **2** | Piezas compartidas aisladas: `src/shared/retry.js`, `src/shared/hubspotSignature.js`, `src/shared/scheduler.js`, con sus tests. Nada montado en `app.js` todavía | Los tres módulos compartidos 100% testeados de forma independiente |
| **3** | Migrar módulo **Jira**: `services/`, `jobs/`, `utils/adf.js`, `store.js` se mueven tal cual (no tocan el framework HTTP). `src/routes/jira/webhooks.js` se **reescribe** como plugin Fastify (`(request, reply)`, ver sección de raw body), registrado con prefix `/jira`. Tests movidos a `test/jira/*` | `test/jira/**` en paridad con los 138 tests actuales. Arranca correctamente con solo variables de Jira definidas (sin las de Slack) |
| **4** | Migrar módulo **Slack**: refactor a DI de `services/hubspot.js` y `services/slack.js`, normalización de `ingest.js` a `{run}`. `src/routes/slack/webhooks.js` se **reescribe** como plugin Fastify igual que en el Hito 3. Se corrige de paso el bug de aislamiento de tests (dotenv) | `test/slack/**` en paridad o mejor que los 29/31 actuales (las 2 que fallan hoy deberían pasar). Arranca con solo variables de Slack definidas |
| **5** | `test/app.test.js` (aislamiento cruzado, ver Verificación), `Dockerfile`/`docker-compose.yml`/`.env.example` únicos, `package.json` consolidado | Suite completa en raíz verde, cobertura ≥80% |
| **6** | Corte: actualizar Target URL de los webhooks en HubSpot (manual, fuera del repo), desplegar en el puerto acordado, README raíz reescrito, doc de evidencia TDD final | Ambos flujos (cron + webhook) verificados en vivo o en un smoke test controlado |
| **7** | *(Requiere confirmación explícita en ese momento)* Borrar `smartflow-hubspot-jira/` y `smartflow-hubspot-slack/` en un commit aparte, idealmente después de un tag de seguridad (`pre-monolith-removal`) | Confirmación + tag creado |

Cada Hito se ejecuta como una tarea separada: se implementa, se corren los tests, se revisa el resultado, y se espera aprobación antes de pasar al siguiente.

## Despliegue

Un solo `Dockerfile` (modelo: el de jira, que ya tiene `HEALTHCHECK` contra `/healthz`) y un solo `docker-compose.yml` con un servicio `app` y un puerto expuesto. No hay ni habrá capa de nginx/reverse-proxy — todo el ruteo es interno al framework (path-based).

## Verificación

- `npm test` (vitest + supertest + mongodb-memory-server, mismo stack que ya usan ambos proyectos) debe quedar en verde en cada Hito, sin perder cobertura respecto a los 138 tests de jira + 31 de slack.
- Los tests HTTP se quedan en `supertest` (funciona igual contra Fastify: `await app.ready()` y luego `supertest(app.server)`) — evita reescribir ~170 tests para usar `fastify.inject()`. Si más adelante se prefiere migrar a `.inject()` (más idiomático en Fastify, no requiere bindear un puerto real), es un cambio aislado a los archivos de test, no al código de producción.
- `test/app.test.js` (Hito 5) debe probar explícitamente los escenarios que motivan este cambio:
  - Un payload HMAC válidamente firmado para Slack enviado a `/jira/webhooks/hubspot` (o viceversa) se rechaza, no se cruza.
  - Una config de Jira inválida/incompleta no rompe `/slack/webhooks/hubspot` ni `/healthz`, y viceversa.
  - `/healthz` refleja el estado real de Mongo sin importar qué integraciones estén configuradas.
- Smoke test manual local antes del corte (Hito 6): levantar el proceso unificado con `mongodb-memory-server` o un Mongo local, ejercitar ambos flujos de cron (ingest) y simular ambos webhooks con curl/HMAC válido, confirmar respuesta 200 y efectos esperados en Mongo/HubSpot.
- Antes de tocar HubSpot en producción (Hito 6), confirmar que los dos proyectos viejos siguen desplegables como rollback.
