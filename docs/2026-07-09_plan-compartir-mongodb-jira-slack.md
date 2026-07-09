# Compartir MongoDB entre smartflow-hubspot-jira y smartflow-hubspot-slack

## Contexto

Hay un requerimiento de infraestructura: en el servidor, `smartflow-hubspot-jira` y su
proyecto hermano `smartflow-hubspot-slack` deben compartir la misma base de datos MongoDB
(misma DB, mismas colecciones) en vez de que cada uno tenga su propia base aislada. Esto
reduce el número de instancias de Mongo que hay que mantener en el servidor.

Es seguro hacerlo porque ambos proyectos ya usan colecciones con nombres distintos y no hay
colisión de datos:

| | jira | slack |
|---|---|---|
| Colección de dedupe | `processed_issues` (índice único `{project, issueKey}`) | `processed_messages` (índice único `{channel, ts}`) |
| Doc de watermark | `_id: 'jira_ingest'` en `watermark` | `_id: 'slack_ingest'` en `watermark` |

El bloqueo real no es de datos sino de infraestructura: `docker-compose.yml` de **jira**
levanta su propio contenedor `mongo` privado (con volumen propio), y **slack** ya
referencia un host `mongo` externo sin definirlo — ambos hardcodean además
`MONGO_URI: mongodb://mongo:27017/<db-propia>` dentro de `environment:`, lo que sobreescribe
cualquier valor puesto en `.env`. Como confirmó el usuario, se va a eliminar el servicio
`mongo` embebido de jira y ambas apps van a depender de una instancia de Mongo externa/compartida
en el servidor (ya gestionada aparte, fuera de estos docker-compose), usando el mismo nombre
de base de datos: **`WherEXdb`**.

No se requieren cambios de código (`src/db/mongo.js`, `src/config.js`, `src/server.js` en
ambos repos ya solo leen `MONGO_URI` desde el entorno, sin nombres de DB hardcodeados).

## Cambios

### 1. `smartflow-hubspot-jira`

- **`docker-compose.yml`**: eliminar el servicio `mongo` y el volumen `mongo_data`, quitar
  `depends_on: [mongo]` y quitar el bloque `environment: MONGO_URI: ...` (para que el valor
  real venga únicamente de `env_file: .env`), igual que ya hace slack.
- **`.env.example`**: cambiar `MONGO_URI=mongodb://localhost:27017/jira_hubspot` →
  `MONGO_URI=mongodb://localhost:27017/WherEXdb`.
- **`.env`** (local, no versionado): actualizar el mismo valor de `MONGO_URI` para desarrollo
  local.
- **`README.md`**: actualizar la fila de `MONGO_URI` (línea ~52, ejemplo de URI) y la sección
  "Deploy con Docker" (líneas ~126-137) que dice que `docker-compose.yml` levanta un servicio
  `mongo` — reemplazar por instrucciones de apuntar a la instancia externa compartida.

### 2. `smartflow-hubspot-slack`

- **`docker-compose.yml`**: quitar el bloque `environment: MONGO_URI: mongodb://mongo:27017/slack_hubspot`
  hardcodeado (línea 9), dejando que `env_file: .env` provea el valor real.
- **`.env.example`**: cambiar `MONGO_URI=mongodb://localhost:27017/slack_hubspot` →
  `MONGO_URI=mongodb://localhost:27017/WherEXdb`.
- **`.env`** (local, no versionado): actualizar el mismo valor de `MONGO_URI`.
- **`README.md`**: corregir el paso "Levantar MongoDB con Docker" (`docker compose up -d mongo`,
  líneas ~81-84) y la nota de que `MONGO_URI` se sobreescribe internamente a
  `mongodb://mongo:27017/slack_hubspot` (línea ~103) — esas instrucciones ya no aplican una vez
  que no hay contenedor `mongo` propio; documentar que se debe usar la instancia compartida
  (en local, se puede levantar una vez con `docker run -d --name shared-mongo -p 27017:27017 -v shared_mongo_data:/data/db mongo:7`).

### 3. Documentar la base compartida

En ambos README, agregar una nota corta indicando que `WherEXdb` es una base de datos
compartida entre `smartflow-hubspot-jira` y `smartflow-hubspot-slack`, listando qué colecciones
pertenecen a cada app (tabla de arriba) para que a futuro no se asuma aislamiento total.

## Verificación

1. `npm test` en ambos repos — los tests usan `mongodb-memory-server`, no se ven afectados por
   el cambio de `MONGO_URI` real.
2. `docker compose config` en ambos repos para validar que los `docker-compose.yml` quedan
   sintácticamente correctos tras quitar los bloques.
3. Smoke manual: levantar una instancia local (`docker run -d -p 27017:27017 mongo:7`), poner
   `MONGO_URI=mongodb://localhost:27017/WherEXdb` en el `.env` real de ambos proyectos, arrancar
   ambos (`npm start`), pegarle a `/healthz` (jira) y `/health` (slack) y confirmar que ambos
   responden OK y que `processed_issues`/`watermark` y `processed_messages`/`watermark` conviven
   sin colisión en la misma base (`mongosh WherEXdb` → `show collections`).
