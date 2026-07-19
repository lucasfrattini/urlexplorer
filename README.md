<div align="center">

# URL Explorer

**Explorador de enlaces y recursos multimedia para sitios paginados.**

Recorre las páginas de una sección, extrae los enlaces que te interesan y
localiza los ficheros que hay dentro de cada uno. Todo desde una interfaz web,
con progreso en tiempo real.

![Node](https://img.shields.io/badge/node-%E2%89%A520-informational)
![Docker](https://img.shields.io/badge/docker-compose-informational)
![Licencia](https://img.shields.io/badge/licencia-MIT-informational)
![Tests](https://img.shields.io/badge/tests-133-success)

</div>

---

## Qué es

URL Explorer es una herramienta **self-hosted** para explorar sitios web
paginados de forma sistemática. Le indicas por dónde empezar, cómo pagina el
sitio y qué buscas; ella recorre, filtra y te devuelve una lista limpia.

Funciona en dos fases:

1. **Recorrer** — sigue la paginación y recoge los enlaces que coinciden con tu
   patrón.
2. **Explorar** — entra en cada enlace y localiza los ficheros de las
   extensiones que hayas indicado.

La segunda fase es opcional: si sólo quieres la lista de enlaces, la omite.

Incluye además un **analizador de página individual** que examina una única URL
a fondo por cuatro vías: DOM renderizado, peticiones de red, reproductores
incrustados y URLs dentro de scripts.

---

## Características

**Motor de recorrido**

- Paginación por **parámetro** (`?page=2`) o por **plantilla** en la URL, lo que
  cubre rutas (`/page/{page}`), numeración con ceros (`{page:02}`) y formatos
  poco habituales.
- **Término de búsqueda parametrizado** con `{q}`: guardas el sitio una vez y
  sólo cambias la palabra.
- Filtro de enlaces por patrón y filtro de ficheros por **extensión real** del
  pathname, no por coincidencia de texto.
- **Renderizado con navegador** opcional, aplicable a las dos fases, para sitios
  que construyen el contenido con JavaScript.

**Resultados**

- **Progreso en tiempo real** por Server-Sent Events, con fases, barra de avance
  y consola de hallazgos según aparecen.
- **Cancelación efectiva**: al cancelar, el servidor deja de trabajar de verdad.
- **Duración de cada vídeo** extraída del HTML, sin peticiones adicionales.
- Filtro de inclusión y de **exclusión** (oculta lo que contenga ciertos
  textos), ordenación por duración o tamaño, copia y exportación.

**Configuraciones**

- Guarda configuraciones de sitio y recupéralas desde un desplegable.
- **Comparte una configuración como enlace**: la URL lleva todos los campos.
- Filtro opcional que conserva sólo el material que declara **licencia abierta**
  (Creative Commons, dominio público), leyendo los metadatos que publica el
  sitio.

**Operación**

- **Docker** con reinicio automático y healthcheck.
- Protección **SSRF**, rate limiting, límites de memoria y duración.
- 133 tests, ESLint y Prettier.

---

## Requisitos

- **Docker** y Docker Compose _(recomendado)_, **o**
- **Node.js ≥ 20** y npm

Para el modo navegador se usa Chromium. La imagen de Docker ya lo incluye; en
instalación local lo aporta Puppeteer.

---

## Instalación

### Con Docker (recomendado)

```bash
git clone https://github.com/<tu-usuario>/urlexplorer.git
cd urlexplorer

cp .env.example .env      # y edítalo a tu gusto
docker compose up -d --build
```

Disponible en **http://localhost:3001**.

El contenedor se reinicia solo si el proceso muere y al arrancar la máquina.

```bash
docker compose logs -f        # ver registro
docker compose restart        # reiniciar
docker compose down           # parar
docker compose up -d --build  # tras cambiar el código
```

> El `--build` no es opcional: `docker compose up -d` a secas no recompila y
> dejaría la imagen con el código anterior.

### Sin Docker

```bash
git clone https://github.com/<tu-usuario>/urlexplorer.git
cd urlexplorer

npm install
cp .env.example .env
npm start
```

En el puerto que indiques en `.env` (3000 por defecto).

```bash
npm run dev     # recarga automática
npm test        # tests
npm run lint    # linter
npm run check   # linter + formato + tests
```

---

## Configuración

Todo se ajusta por variables de entorno. `.env.example` documenta las opciones
con sus valores por defecto; sólo `PORT` es necesaria para arrancar.

Las más relevantes:

| Variable                           | Por defecto | Para qué                                             |
| ---------------------------------- | ----------- | ---------------------------------------------------- |
| `PORT`                             | `3000`      | Puerto del servidor                                  |
| `ADMIN_TOKEN`                      | _(vacío)_   | Desbloquea las configuraciones guardadas (ver abajo) |
| `CRAWL_MAX_PAGES`                  | `50`        | Máximo de páginas por exploración                    |
| `CRAWL_MAX_FILES`                  | `5000`      | Tope de ficheros en memoria                          |
| `CRAWL_MAX_DURATION_MS`            | `600000`    | Duración máxima de una exploración                   |
| `BROWSER_ENABLED`                  | `true`      | Permitir el modo navegador                           |
| `BROWSER_POOL_SIZE`                | `2`         | Pestañas simultáneas                                 |
| `THROTTLE_MIN_INTERVAL_MS`         | `250`       | Intervalo mínimo entre peticiones al mismo dominio   |
| `THROTTLE_MAX_CONCURRENT_PER_HOST` | `4`         | Peticiones simultáneas por dominio                   |
| `SECURITY_BLOCK_PRIVATE_ADDRESSES` | `true`      | Protección SSRF                                      |
| `SECURITY_ALLOWED_HOSTS`           | _(vacío)_   | Lista blanca opcional de dominios                    |
| `RATE_LIMIT_MAX_REQUESTS`          | `30`        | Peticiones por ventana                               |

### `ADMIN_TOKEN`

Las configuraciones guardadas quedan detrás de un desbloqueo manual. Está
pensado para el caso en que **varias personas comparten el mismo ordenador**:
por defecto la herramienta aparece vacía, sin configuraciones visibles y sin
posibilidad de guardar.

```env
ADMIN_TOKEN=pon-aqui-tu-token
```

Si se deja vacío, el modo queda deshabilitado y la aplicación funciona con
normalidad, simplemente sin configuraciones guardadas.

> **Nunca** pongas el token real en `.env.example` ni en ningún fichero
> versionado. `.env` está en `.gitignore` precisamente por eso.

### Seguridad

La protección SSRF viene activada e impide que la aplicación alcance
direcciones de loopback, redes privadas, enlace local o multicast, incluso si
un dominio público resuelve a una de ellas. Sólo desactívala para pruebas
contra servidores locales, nunca en un despliegue accesible.

---

## Cómo se usa

### Explorar un sitio

1. **URL de partida** — desde dónde empieza el recorrido. Admite dos
   marcadores:
   - `{q}` — el término a buscar
   - `{page}` — el número de página (`{page:02}` si el sitio usa `01`, `02`, …)
2. **Término a buscar** — lo que se inserta donde esté `{q}`.
3. **Patrón de enlace** — qué enlaces te interesan. Vacío los coge todos.
4. **Extensiones a buscar** — separadas por comas. Vacío omite la segunda fase.

Averiguar cómo pagina un sitio es sencillo: pasa a la página 2 y mira qué
cambia en su URL.

| Lo que ves al pasar de página | Qué configuras                                     |
| ----------------------------- | -------------------------------------------------- |
| `ejemplo.com/videos?page=2`   | Parámetro de página: `page`                        |
| `ejemplo.com/videos/page/2`   | URL de partida: `ejemplo.com/videos/page/{page}`   |
| `ejemplo.com/lista/02.html`   | URL de partida: `ejemplo.com/lista/{page:02}.html` |

Si la URL no cambia, el sitio pagina con JavaScript: abre las herramientas de
desarrollo, pestaña **Red → Fetch/XHR**, pulsa la página 2 y copia la URL que
aparece. Esa es la que funciona.

### Analizar una página

En la pestaña **Videos**, introduce una URL para examinarla a fondo. Útil para
diagnosticar: si el explorador encuentra enlaces pero ningún fichero, esta
pestaña te dice qué hay realmente en esa página.

---

## API

| Método | Ruta                 | Descripción                                            |
| ------ | -------------------- | ------------------------------------------------------ |
| `GET`  | `/api/health`        | Estado del servicio y límites vigentes                 |
| `POST` | `/api/scrape`        | Exploración completa, respuesta única                  |
| `GET`  | `/api/scrape/stream` | La misma exploración con progreso en tiempo real (SSE) |
| `POST` | `/api/video/extract` | Análisis de una URL individual                         |

```bash
curl -X POST http://localhost:3001/api/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "searchUrl": "https://ejemplo.com/buscar?q={q}",
    "searchTerm": "paisajes",
    "pageParam": "page",
    "linkPattern": "/videos/",
    "fileExtensions": ".mp4,.webm",
    "endPage": 3
  }'
```

---

## Arquitectura

```
server.js              arranque y apagado ordenado
src/
  app.js               aplicación Express y cabeceras de seguridad
  config/              toda la configuración, ajustable por entorno
  lib/                 url, ssrf, http, throttle, browser, license, media
  services/            scraper (dos fases) y video (análisis individual)
  routes/              endpoints
  middleware/          rate limiting y manejo de errores
public/                interfaz web, ES modules sin build
tests/                 133 tests con node:test
```

El frontend es JavaScript nativo sin empaquetador: el despliegue es
`npm start` sin pipeline de compilación, y eso permite servir una política de
seguridad de contenido estricta sin `unsafe-inline`.

---

## Uso responsable

Esta herramienta automatiza algo que ya puedes hacer a mano en un navegador,
pero mucho más rápido. Con eso vienen responsabilidades:

- **Respeta las condiciones de uso** de los sitios que explores. Muchos
  prohíben expresamente el acceso automatizado.
- **El contenido tiene autor.** Que un fichero sea accesible no significa que
  sea libre de usar. La ausencia de licencia declarada equivale a _todos los
  derechos reservados_, no a dominio público.
- **No satures los servidores ajenos.** La herramienta limita por defecto las
  peticiones simultáneas y el intervalo entre ellas por dominio; súbelos con
  criterio.
- La herramienta no elude ningún control de acceso ni protección técnica, y no
  está pensada para ello.

Úsala con contenido propio, con material de licencia abierta, o allí donde
tengas permiso.

---

## Contribuir

```bash
npm run check   # linter + formato + tests: debe pasar antes de un commit
```

Las incidencias y propuestas son bienvenidas. Si vas a añadir soporte para un
tipo de paginación nuevo, `src/lib/url.js` y `src/services/scraper.js` son los
puntos de entrada.

---

## Licencia

MIT.
