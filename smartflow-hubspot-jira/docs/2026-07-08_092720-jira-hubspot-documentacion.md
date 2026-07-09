# Integración JIRA ⇄ HubSpot — Documentación técnica

**Arquitectura monolítica** · tarea programada de ingesta + API de callback
Stack: Node.js + Express + node-cron + MongoDB

> **Nota de mapeo:** En HubSpot, los "tickets" del flujo original Slack se reemplazan por **Tasks** (objeto nativo `tasks` de HubSpot CRM). La clave de dedup sigue siendo `jira_issue_key`. El workflow de callback se dispara cuando la **Task se marca como Completed** (o se mueve a su status terminal equivalente).

---

## 1. Objetivo

Dos flujos independientes sobre un mismo monolito:

- **Flujo A (Ingesta):** cada *X* minutos (configurable) leer los **issues nuevos/modificados** de uno o más proyectos de JIRA y crear una **Task** en HubSpot por cada issue, sin duplicar.
- **Flujo B (Callback):** cuando una Task se marca como **Completed** en HubSpot, **agregar un comentario en el issue de JIRA** que originó la task (y, opcionalmente, **transicionar su status a "Done"**) para reflejar la resolución de vuelta en JIRA.

---

## 2. Arquitectura general

Un solo proceso Node.js con dos "entradas":

1. Un **scheduler interno** (`node-cron`) que dispara el job de ingesta.
2. Un **servidor HTTP** (Express) que expone el webhook que HubSpot invoca al completar un ticket.

Ambos comparten los mismos servicios (`JiraService`, `HubSpotService`) y una base **MongoDB** que guarda el *watermark* (timestamp del último poll) y, opcionalmente, un log de deduplicación.

```
                 ┌──────────────────────── MONOLITO (Node.js) ────────────────────────┐
    JIRA  ◀────▶ │  node-cron ──▶ JiraService ──▶ Dedup ──▶ HubSpotService ──▶ tasks   │ ◀────▶ HubSpot
                 │  Express /webhooks/hubspot ──▶ HubSpotService + JiraService          │
                 │  MongoDB: watermark + log de dedup                                   │
                 └──────────────────────────────────────────────────────────────────────┘
```

> Todo corre en un solo despliegue (tu VPS Hostinger con Docker sirve perfecto). No hay colas ni microservicios: es intencionalmente simple para el plazo jueves→lunes.

---

## 3. Componentes

| Módulo | Responsabilidad |
|---|---|
| `server.js` | Arranca Express + registra el cron. Punto de entrada. |
| `scheduler.js` | Define el `cron.schedule` con el intervalo configurable e invoca el job de ingesta. |
| `jobs/ingestJira.js` | Lógica del Flujo A: calcular ventana, leer JIRA vía JQL, deduplicar, crear tasks, mover watermark. |
| `services/jira.js` | Wrapper de la API REST de JIRA Cloud: `searchIssues(jql)`, `addComment(issueKey, body)`, `transitionIssue(issueKey, transitionId)`. |
| `services/hubspot.js` | Wrapper REST CRM v3: `findTaskByJiraKey()`, `createTask()`, `getTask()`. |
| `routes/webhooks.js` | Flujo B: recibe el POST de HubSpot, valida, arma la respuesta a JIRA. |
| `db/mongo.js` | Conexión y acceso a `watermark` y `processed_issues`. |
| `config.js` | Carga y valida variables de entorno. |

---

## 4. Flujo A — Ingesta programada (JIRA → HubSpot)

### 4.1 Cálculo de la ventana de tiempo

Tu ejemplo: si el intervalo es 5 min y el job corre a la 1:05, debe traer los issues modificados en **1:00 → 1:05**.

**Recomendación:** en vez de calcular la ventana como `[ahora - X, ahora]` (frágil: si una corrida falla o se retrasa, se pierden issues o se solapan), usa un **watermark persistido**:

- `oldest` = `watermark.updatedAt` (timestamp ISO del último poll exitoso; en el primer arranque, `ahora - X`).
- `latest` = `ahora`.
- JQL base: `project = {JIRA_PROJECT_KEY} AND updated >= "<oldest>" ORDER BY updated ASC`.
- Al terminar, `watermark.updatedAt` = el `updated` del issue más reciente procesado.

Esto cumple tu regla de "los últimos X minutos" en el caso normal, pero **si una corrida se salta, la siguiente recupera el hueco automáticamente** sin perder issues. La deduplicación (sección 6) hace que cualquier solape sea inofensivo.

> JIRA devuelve fechas en formato ISO 8601 (ej. `"2026-07-08T14:25:00.000+0000"`). Trabaja siempre con el campo `updated` del issue, no con la hora local del servidor.

### 4.2 Leer issues de JIRA

```js
// services/jira.js
const fetch = require('node-fetch'); // o axios, lo que prefieras

class JiraService {
  constructor({ baseUrl, email, apiToken }) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // e.g. https://tu-org.atlassian.net
    this.auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  }

  async searchIssues(jql, fields = ['summary', 'description', 'reporter', 'assignee', 'updated', 'status', 'project']) {
    const issues = [];
    let nextPageToken; // JIRA Cloud usa nextPageToken en POST /search/jql (v3)
    do {
      const res = await fetch(`${this.baseUrl}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          jql,
          fields,
          maxResults: 100,
          nextPageToken,
        }),
      });
      if (!res.ok) throw new Error(`JIRA ${res.status}: ${await res.text()}`);
      const data = await res.json();
      issues.push(...(data.issues || []));
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);
    return issues;
  }
}

module.exports = JiraService;
```

- Filtra por tipo de issue si quieres ignorar subtareas: añade `AND issuetype NOT IN (Sub-task)` a la JQL.
- Ignora issues en estados terminales si no quieres re-crear tickets en cada poll: `AND status NOT IN (Done, Closed, Cancelled)`.
- Para responder al issue en el Flujo B, guarda `issue.key` como `jira_issue_key` (ej. `"PROJ-123"`). Es único a nivel global por definición.
- Si necesitas el `commentId` para ediciones posteriores, guárdalo en `jira_comment_id` cuando lo crees.

### 4.3 Deduplicar y crear la task

Por cada issue nuevo/modificado:

1. Buscar si ya existe una task con esa `jira_issue_key` (sección 6).
2. Si no existe → crear la task con las propiedades JIRA.

```js
// services/hubspot.js
async function createTask(issue) {
  // HubSpot Tasks usan /crm/v3/objects/tasks. Las propiedades nativas
  // (hs_task_subject, hs_task_status, hs_task_priority, etc.) están
  // siempre disponibles; las custom (jira_*) las creamos en la sección 7.
  const body = {
    properties: {
      hs_task_subject: (issue.fields.summary || `Issue ${issue.key}`).slice(0, 120),
      hs_task_body: extractDescription(issue), // helper ADF → texto plano (ver nota)
      hs_task_status: 'NOT_STARTED',           // 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' (también acepta nombres legacy)
      hs_task_priority: 'MEDIUM',
      jira_issue_key: issue.key,
      jira_project_key: issue.fields.project?.key || '',
      jira_url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
      jira_reporter: issue.fields.reporter?.displayName || '',
      jira_assignee: issue.fields.assignee?.displayName || '',
    },
  };
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}
```

> **Nota sobre `description`:** JIRA Cloud usa ADF (Atlassian Document Format) en lugar de texto plano. Necesitas un helper que extraiga el texto del ADF (`extractDescription`) o un parser ADF→markdown. Para MVP puedes usar `lib:adf-to-text` o un walker recursivo simple que junte todos los nodos `text`.

3. Al terminar el lote, actualizar el `watermark` con el `updated` máximo procesado.

---

## 5. Flujo B — Callback de finalización (HubSpot → JIRA)

### 5.1 Disparo desde HubSpot

Dos opciones para detectar "task completada":

- **(Recomendada, más simple) Workflow con acción Webhook:** crear un workflow basado en **Tasks** con criterio *"Task status = Completed"* (o `hs_task_status` igual a `COMPLETED`) y acción **Send a webhook (POST)** hacia `https://TU-DOMINIO/webhooks/hubspot`. HubSpot envía el `objectId` de la task.
- **Webhook Subscriptions de la app privada:** suscribirse a `task.propertyChange` sobre `hs_task_status` y filtrar en tu código por el valor `COMPLETED`. Más control, un poco más de código.

### 5.2 Endpoint de la API

`POST /webhooks/hubspot`

**Pasos del handler:**

1. **Validar el origen.** Si usas Webhook Subscriptions, verifica la firma `X-HubSpot-Signature-v3` con tu `WEBHOOK_SECRET`. Si usas la acción de workflow, protege con un token secreto en la URL/header.
2. Obtener el `taskId` del payload.
3. `GET /crm/v3/objects/tasks/{taskId}?properties=jira_issue_key,jira_comment_id,jira_listo_sent,hs_task_status`.
4. (Si vino por subscription) confirmar que `hs_task_status === 'COMPLETED'`.
5. Postear en JIRA:

```js
// services/jira.js
async function respondToIssue(issueKey) {
  const comment = `✅ Resuelto vía HubSpot el ${new Date().toISOString()}.`;

  // 1) Agregar comentario (analogo a "responder en el hilo" de Slack)
  const c = await fetch(`${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${this.auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: comment }] },
        ],
      },
    }),
  });
  if (!c.ok) throw new Error(`JIRA comment ${c.status}: ${await c.text()}`);
  const created = await c.json();
  const commentId = created.id;

  // 2) Transicionar a "Done" (opcional pero recomendado)
  if (process.env.JIRA_TRANSITION_DONE_ID) {
    await fetch(`${this.baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transition: { id: process.env.JIRA_TRANSITION_DONE_ID } }),
    });
  }
  return commentId;
}
```

6. Responder `200 OK` **rápido** (HubSpot reintenta si tarda demasiado o falla). Si el trabajo pesado pudiera demorar, responde 200 y procesa aparte; aquí es tan liviano que no hace falta.

**Idempotencia:** opcionalmente marca el ticket (`jira_listo_sent = true`) o registra el `ticketId` para no postear dos veces si HubSpot reintenta.

---

## 6. Deduplicación

**Clave de dedup:** `jira_issue_key` (el `key` de JIRA es único por definición, ej. `"PROJ-123"`). A diferencia de Slack, no necesita combinarse con un canal — el key ya es global.

**Antes de crear cada task**, consulta el Search API de HubSpot:

```js
async function findTaskByJiraKey(key) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/tasks/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{ filters: [
        { propertyName: 'jira_issue_key', operator: 'EQ', value: key },
      ]}],
      properties: ['hs_object_id', 'jira_issue_key'],
      limit: 1,
    }),
  });
  const data = await res.json();
  return data.total > 0 ? data.results[0] : null;
}
```

**Doble red (recomendado):** además guarda cada `issueKey` procesado en la colección `processed_issues` de Mongo con índice único. Así evitas dobles inserciones aunque el Search API tenga latencia de indexación (el Search de HubSpot no es instantáneo tras crear un objeto). El índice único de Mongo es tu garantía dura contra duplicados dentro de una misma corrida y entre corridas solapadas.

```js
// índice único
db.collection('processed_issues').createIndex(
  { project: 1, issueKey: 1 }, { unique: true }
);
```

---

## 7. Propiedades a crear en HubSpot (objeto Task)

El objeto `tasks` de HubSpot ya viene con propiedades nativas (`hs_task_subject`, `hs_task_status`, `hs_task_priority`, `hs_task_body`, `hs_task_due_date`, etc.) — no hace falta crearlas. Lo que sí creamos son las **propiedades custom** que guardan trazabilidad hacia JIRA.

Créalas una vez vía UI (Settings → Properties → Tasks) o por API (`POST /crm/v3/properties/tasks`).

| Nombre interno | Tipo | Uso |
|---|---|---|
| `jira_issue_key` | Single-line text | **Clave de deduplicación** (key único del issue) |
| `jira_project_key` | Single-line text | Proyecto de origen |
| `jira_url` | Single-line text | Enlace directo al issue (trazabilidad) |
| `jira_reporter` | Single-line text | Quién reportó el issue (opcional) |
| `jira_assignee` | Single-line text | Asignado actual (opcional) |
| `jira_comment_id` | Single-line text | ID del comentario creado en Flujo B |
| `jira_listo_sent` | Booleano (opcional) | Idempotencia del Flujo B |

Ejemplo de creación por API:

```json
POST /crm/v3/properties/tasks
{
  "name": "jira_issue_key",
  "label": "JIRA Issue Key",
  "type": "string",
  "fieldType": "text",
  "groupName": "taskinformation"
}
```

---

## 8. Configuración (variables de entorno)

```dotenv
# JIRA (Cloud)
JIRA_BASE_URL=https://tu-org.atlassian.net
JIRA_EMAIL=tu-cuenta@tu-org.com
JIRA_API_TOKEN=ATATT3xFfGF0...   # https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_PROJECT_KEY=PROJ            # o varios, separados por coma, según tu JQL
JIRA_TRANSITION_DONE_ID=31       # ID de la transición a "Done" (opcional)

# HubSpot (private app)
HUBSPOT_TOKEN=pat-na1-...
# (Ya no se usan pipeline/stage de tickets — las tasks usan hs_task_status)

# Scheduler
POLL_INTERVAL_MIN=5

# API
PORT=3000
WEBHOOK_SECRET=cadena-larga-secreta

# Mongo (compartida con smartflow-hubspot-slack: base WherEXdb)
MONGO_URI=mongodb://localhost:27017/WherEXdb
```

**Permisos de JIRA (cuenta Atlassian):** la cuenta asociada al API Token debe tener:
- Acceso de lectura al/los proyectos (Browse Projects, View Issues).
- Permiso de comentar issues (Add Comments).
- Permiso de transicionar issues (Transition Issues) si usas `JIRA_TRANSITION_DONE_ID`.

El API Token se genera en *Atlassian Account Settings → Security → API tokens* y los permisos que hereda son los de la cuenta — no hay scopes granulares por token como en Slack.

**Scopes de HubSpot (app privada):** `tasks` (read/write) y `crm.objects.tasks.read/write`. Ya no se necesita el scope `tickets` para nada.

---

## 9. Modelo de datos en MongoDB

```
watermark            { _id: "jira_ingest", updatedAt: "2026-07-08T14:25:00.000Z", lastIssueKey: "PROJ-123" }
processed_issues     { project, issueKey, taskId, createdAt }   // índice único (project, issueKey)
```

`watermark` es un único documento que avanza en cada corrida. `processed_issues` es la red de seguridad de dedup y sirve de auditoría (qué issue generó qué task).

---

## 10. Casos borde y manejo de errores

- **Corrida fallida / VPS reiniciado:** al usar watermark persistido, la siguiente corrida recupera el rango pendiente. No pierdes issues.
- **Solape de ventanas:** inofensivo gracias a la dedup por `issueKey` + índice único.
- **Rate limits:** JIRA Cloud tiene un rate limit de ~10.000 req/h por token (≈170 req/min). Con paginado (`maxResults: 100` + `nextPageToken`) vas sobrado; añade *retry* con backoff en 429.
- **Latencia de indexado del Search de HubSpot:** por eso la doble red con Mongo.
- **Reintentos de HubSpot en el webhook:** responde 200 rápido y hazlo idempotente (`jira_listo_sent`).
- **ADF (Atlassian Document Format):** el `description` viene en ADF (JSON anidado), no en texto plano. Necesitas un extractor a texto o markdown. Para MVP, un walker recursivo que junte todos los nodos `text` es suficiente.
- **Issues sin `description`:** usa un subject por defecto (`Issue {key}`).
- **Subtareas:** decide si las ingieres (`issuetype NOT IN (Sub-task)` para excluirlas) o las creas como tasks separadas.
- **Issues en proyectos archivados:** JIRA responde 404 o lista vacía; trátalo como "no hay issues nuevos" y sigue.
- **Issue ya transicionado a Done antes del Flujo B:** el reintento de HubSpot puede repetir el `addComment`; usa `jira_listo_sent` como guarda.
- **Issues con `updated` futuro o timezone raro:** normaliza a UTC al guardar el watermark para no retroceder la ventana.
- **Task de HubSpot borrada manualmente:** el callback puede llegar con un `taskId` ya inexistente. Maneja el 404 de `GET /tasks/{id}` y responde 200 (o reintenta) sin romper el flujo.
- **Users sin asociar en HubSpot:** las tasks existen sin owner. Si necesitas asignar a un usuario de HubSpot, agrega `hubspot_owner_id` a las properties custom y resuélvelo en `createTask`.

---

## 11. Estructura de proyecto sugerida

```
src/
  server.js            # Express + arranque del cron
  config.js
  scheduler.js
  jobs/
    ingestJira.js      # Flujo A
  routes/
    webhooks.js        # Flujo B (POST /webhooks/hubspot)
  services/
    jira.js
    hubspot.js
  db/
    mongo.js
.env
Dockerfile
```

Cron con node-cron:

```js
// scheduler.js
const cron = require('node-cron');
const { ingest } = require('./jobs/ingestJira');
const min = process.env.POLL_INTERVAL_MIN || 5;
cron.schedule(`*/${min} * * * *`, () => ingest().catch(console.error));
```

---

## 12. Plan de implementación (jueves → lunes)

| Día | Entregable |
|---|---|
| **Jue** | Crear las propiedades en HubSpot. App privada de HubSpot + API Token de JIRA con permisos. Repo base (Express + config + Mongo + healthcheck). Probar `JiraService.searchIssues` con una JQL real contra un proyecto de prueba. |
| **Vie** | Flujo A completo: `JiraService.searchIssues` con JQL + watermark, `HubSpotService.createTask`, dedup (Search + índice Mongo). Helper ADF→texto. Probar end-to-end con issues reales. |
| **Sáb/Dom** | Flujo B: endpoint `/webhooks/hubspot`, `getTask`, `addComment` + `transitionIssue` en JIRA, idempotencia. Configurar el workflow de HubSpot (Tasks → hs_task_status = COMPLETED → Send webhook). |
| **Lun** | Pruebas end-to-end de ambos flujos, manejo de 429/errores, deploy en el VPS (Docker), y validar dedup con casos solapados. |

---

*Documento base para el MVP. Ajusta `JIRA_TRANSITION_DONE_ID` y los valores de `hs_task_status` (`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`) a tu portal antes de desplegar.*
