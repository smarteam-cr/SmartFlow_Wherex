# Filtrar tickets Jira → HubSpot: solo "Tipo de Asistencia" = CC

## Contexto

Hoy el job de ingesta (`src/modules/jira/jobs/ingest.js`) sincroniza a HubSpot **todo** issue del proyecto `P30` que no esté duplicado, sin mirar su clasificación. El pedido es que solo entren a HubSpot los tickets cuyo campo "Tipo de Asistencia" (visible en el formulario adjunto de Jira Service Management) empiece con **"CC"** (Customer Care); los que empiecen con "ING" (Ingeniería) — o que no tengan ese dato — deben quedar fuera.

Investigación en vivo contra el Jira real (solo lecturas, mismas credenciales que ya usa `scripts/check-jira-issue.js`) confirmó dos cosas clave que cambian el diseño:

1. **No es un campo único.** "Tipo de Asistencia" es una pregunta de un formulario de Jira Service Management (Forms/ProForma) que Jira sincroniza automáticamente a un **custom field distinto por línea de producto**. Se confirmó consultando el registro completo de campos de la instancia (`GET /rest/api/3/field`, 876 campos totales) que existen exactamente 4:
   - `customfield_10822` → "Tipo de Asistencia / Sourcing"
   - `customfield_10823` → "Tipo de Asistencia / DataOps"
   - `customfield_10824` → "Tipo de Asistencia / FyC"
   - `customfield_10825` → "Tipo de Asistencia / Pay"

   Solo el campo del producto que el usuario eligió en el formulario queda con valor; los otros tres quedan `null`. Verificado con el ticket real `P30-12142`: `customfield_10822` = `{ value: "CC - Registro y accesos", id: "12557" }`, los otros tres en `null`.

2. **El dato SÍ está disponible en el endpoint que ya usa el job de ingesta.** `jira.searchIssues()` (que llama a `POST /rest/api/3/search/jql`) devuelve exactamente la misma forma para estos custom fields que `getIssue()`, confirmado en vivo. Esto importa porque hoy el job solo pide campos estándar (`summary, description, reporter, assignee, updated, status, project, issuetype`, `ingest.js:57`) y recién llama a `getIssue()` **después** de crear el ticket (línea 99, solo para la nota). Si agregamos los 4 custom fields a la lista de `fields` de `searchIssues`, el filtro puede aplicarse **antes** de decidir si se crea el ticket — no hace falta ningún llamado nuevo a la API de Forms/ProForma ni tocar la arquitectura de polling existente.

Decisiones confirmadas con el usuario:
- Si ninguno de los 4 campos tiene valor (ticket no es "Solicitud de asistencia", o el formulario no se llenó), **no se sincroniza** — es allow-list estricta, no blocklist.
- El cambio aplica solo hacia adelante (tickets nuevos del job de ingesta). No se tocan tickets ya creados en HubSpot.

## Cambios

Seguir el patrón exacto que ya existe para `skipSubtasks` / `excludeStatuses` en `createIngestJob` (`src/modules/jira/jobs/ingest.js`): un filtro opcional, activado por config, evaluado en el loop por-issue antes de tocar Mongo/HubSpot.

### 1. Nuevo helper — `src/modules/jira/utils/assistanceType.js` (nuevo archivo)

Llamado desde `src/modules/jira/jobs/ingest.js` (import nuevo al inicio del archivo + uso en el loop por-issue, punto 2). No existe hoy ningún archivo que resuelva el valor de "Tipo de Asistencia" — confirmado por la exploración inicial (cero referencias a "Tipo de Asistencia", "CC -", "ING -", "Customer Care" en todo el repo) y por la búsqueda en vivo contra Jira, que mostró que este dato nunca se leyó antes en el código.

Función pura, sin dependencias, siguiendo el estilo de `utils/adf.js` / `utils/issueNote.js`:

```js
function isCustomerCareAssistance(fields, fieldIds) {
  for (const fieldId of fieldIds) {
    const raw = fields?.[fieldId];
    const value = raw && typeof raw === 'object' ? raw.value : raw;
    if (typeof value === 'string' && value.trim().startsWith('CC')) return true;
  }
  return false;
}

module.exports = { isCustomerCareAssistance };
```

Maneja tanto la forma `{ value: "CC - ...", id, self }` (custom field tipo select, lo que devuelve Jira hoy, verificado en vivo) como un string plano, por robustez.

### 2. `src/modules/jira/jobs/ingest.js`

- Nuevo parámetro del constructor: `assistanceTypeFieldIds = []`.
- Línea 57: agregar `...assistanceTypeFieldIds` al array de `fields` de `searchIssues` (si el array está vacío, no cambia nada — comportamiento actual intacto).
- En el loop por-issue (junto a los checks de `skipSubtasks`/`excludeStatuses`, líneas 70-78), agregar:
  ```js
  if (
    assistanceTypeFieldIds.length > 0 &&
    !isCustomerCareAssistance(iss?.fields, assistanceTypeFieldIds)
  ) {
    result.skipped += 1;
    continue;
  }
  ```
  Va antes de `store.isProcessed`/`hubspot.findTicketByJiraKey` para no gastar llamadas a Mongo/HubSpot en tickets que de todas formas se van a saltar.

### 3. `src/config/jira.js`

Agregar var de entorno opcional `JIRA_ASSISTANCE_TYPE_FIELD_IDS` (coma-separado, mismo patrón que `JIRA_PROJECT_KEY` en líneas 43-46). Si no está seteada → array vacío → filtro desactivado (retrocompatible). Exponer como `JIRA_ASSISTANCE_TYPE_FIELD_IDS` en `values`.

### 4. `src/start.js`

En `buildJiraIntegration` (línea 31-37), pasar `assistanceTypeFieldIds: cfg.JIRA_ASSISTANCE_TYPE_FIELD_IDS` al `createJiraIngestJob({...})`. Hoy este wiring falta incluso para `skipSubtasks`/`excludeStatuses` (quedan sin usar en producción) — no se toca eso, solo se agrega el wiring del filtro nuevo.

### 5. `.env` y `.env.example`

- `.env` (no versionado, ya existe con `JIRA_PROJECT_KEY=P30` y demás credenciales): agregar la línea `JIRA_ASSISTANCE_TYPE_FIELD_IDS=customfield_10822,customfield_10823,customfield_10824,customfield_10825` para que el filtro quede activo en este deploy. No se toca ninguna otra línea del archivo.
- `.env.example`: agregar la misma variable documentada (no es un secreto, son IDs de campo), con un comentario breve explicando qué es y cómo encontrar más si Jira agrega otra línea de producto (`GET {JIRA_BASE_URL}/rest/api/3/field`, buscar por nombre "Tipo de Asistencia").

### 6. Tests

- **Nuevo** `test/jira/utils-assistanceType.test.js`: casos para `isCustomerCareAssistance` — un campo con "CC - ...", todos `null`, un campo con "ING - ...", varios field IDs donde solo uno tiene valor, string plano vs `{value}`.
- **Extender** `test/jira/jobs-ingest.test.js`:
  - Extender el fixture `issue({...})` (línea 51) para aceptar un objeto de campos extra que se mezcle en `fields` (para poder simular `customfield_10822: { value: 'CC - Registro y accesos' }`).
  - Nuevo test, mismo estilo que el de `excludeStatuses` (líneas 287-307): con `assistanceTypeFieldIds` seteado, mezcla de issues CC / ING / sin dato → verificar `result.created` y `result.skipped`.
  - Nuevo test: sin `assistanceTypeFieldIds` (default), todo se sincroniza igual que hoy (retrocompatibilidad).

## Verificación

1. `npm test` (vitest) — deben pasar los tests existentes de `test/jira/*.test.js` sin cambios de comportamiento cuando `assistanceTypeFieldIds` no está seteado, más los nuevos casos.
2. No se hace una corrida en vivo contra Jira/HubSpot como parte de la verificación (crearía/modificaría datos reales); la validación es vía el suite de tests, que ya sigue el patrón de mocks de `fakeJira`/`fakeHubspot` usado en todo `jobs-ingest.test.js`.
