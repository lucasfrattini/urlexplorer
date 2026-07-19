<div align="center">

# URL Explorer

**Explorador de enlaces y recursos multimedia para sitios paginados.**

Recorre las páginas de una sección, extrae los enlaces que te interesan y
localiza los ficheros que hay dentro de cada uno. Todo desde una interfaz web,
con progreso en tiempo real.

![Node](https://img.shields.io/badge/node-%E2%89%A520-informational)
![Docker](https://img.shields.io/badge/docker-compose-informational)
![Licencia](https://img.shields.io/badge/licencia-MIT-informational)
![Tests](https://img.shields.io/badge/tests-263-success)

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

- Tres modos de paginación: por **parámetro** (`?page=2`), por **plantilla** en
  la URL —que cubre rutas (`/page/{page}`), numeración con ceros (`{page:02}`)
  y formatos poco habituales— y **scroll infinito**, para sitios que cargan más
  resultados al bajar en vez de tener una URL por página.
- **Autodetección de configuración**: pega la URL de resultados y la
  herramienta propone patrón, paginación, extensiones y si hace falta
  navegador, explicando el porqué de cada campo. Es una sugerencia editable,
  nunca una configuración impuesta.
- **Término de búsqueda parametrizado** con `{q}`: guardas el sitio una vez y
  sólo cambias la palabra.
- Filtro de enlaces por patrón —texto o **expresión regular** entre barras,
  `/\/videos\/\d+/`, para distinguir fichas de páginas de sección— y filtro de
  ficheros por **extensión real** del pathname, no por coincidencia de texto.
- **Renderizado con navegador** opcional, aplicable a las dos fases, para sitios
  que construyen el contenido con JavaScript.

**Resultados**

- **Progreso en tiempo real** por Server-Sent Events, con fases, barra de avance
  y consola de hallazgos según aparecen.
- **Cancelación efectiva**: al cancelar, el servidor deja de trabajar de verdad.
- **Duración y tamaño de cada fichero** extraídos del HTML, sin peticiones
  adicionales. El tamaño del servidor es exacto; el leído de la ficha se marca
  con `~` para no confundirlos.
- **Agrupación de duplicados** dentro de una misma búsqueda: el mismo contenido
  servido desde dos sitios se pliega bajo un solo resultado. Nunca se descarta
  nada, y un interruptor deshace la agrupación.
- Filtro de inclusión y de **exclusión** (oculta lo que contenga ciertos
  textos), ordenación por duración o tamaño, copia y exportación.

**Configuraciones**

- Guarda configuraciones de sitio y recupéralas desde un desplegable.
- **Comparte una configuración como enlace**: la URL lleva todos los campos.
- Filtro opcional que conserva sólo el material que declara **licencia abierta**
  (Creative Commons, dominio público), leyendo los metadatos que publica el
  sitio.

**Extensibilidad**

- Los sitios que el motor genérico no cubre se resuelven con **módulos
  aislados** en `src/extensions/`, en vez de acumular casos particulares en el
  núcleo. El cargador solo lee de ese directorio del repositorio: añadir una
  extensión es añadir código revisado, nunca cargarlo desde fuera.

**Operación**

- **Docker** con reinicio automático y healthcheck.
- Protección **SSRF**, rate limiting, límites de memoria y duración.
- 263 tests, ESLint y Prettier.

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
| `SCROLL_MAX_ROUNDS`                | `50`        | Cargas máximas en modo scroll                        |
| `SCROLL_MAX_DURATION_MS`           | `120000`    | Tiempo máximo de la fase de scroll                   |
| `SCROLL_MAX_ELEMENTS`              | `3000`      | Enlaces acumulados a partir de los cuales para       |
| `THROTTLE_MIN_INTERVAL_MS`         | `250`       | Intervalo mínimo entre peticiones al mismo dominio   |
| `THROTTLE_MAX_CONCURRENT_PER_HOST` | `4`         | Peticiones simultáneas por dominio                   |
| `SECURITY_BLOCK_PRIVATE_ADDRESSES` | `true`      | Protección SSRF                                      |
| `SECURITY_ALLOWED_HOSTS`           | _(vacío)_   | Lista blanca opcional de dominios                    |
| `RATE_LIMIT_MAX_REQUESTS`          | `30`        | Peticiones por ventana                               |
| `ADMIN_UNLOCK_MAX_ATTEMPTS`        | `5`         | Intentos de desbloqueo por minuto                    |

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

Las configuraciones **se guardan en el servidor**, en `data/profiles.json`, no
en el navegador. Ese directorio está en `.gitignore`: los sitios que configures
no acaban en el repositorio. Una instalación nueva arranca sin ninguna, que es
el comportamiento correcto.

Para desbloquear, **pulsa cinco veces el logo de la cabecera en menos de dos
segundos** e introduce el token. El mismo gesto vuelve a bloquear. El
desbloqueo vive en `sessionStorage`: al cerrar la pestaña, la herramienta
vuelve a aparecer vacía para quien se siente después.

Es un gate de uso cotidiano, no un control frente a un atacante decidido: quien
comparte el ordenador puede mirar mientras escribes o leer el `sessionStorage`
con la sesión abierta. Lo que sí garantiza es que las configuraciones no están
en el código servido y que el guardado se valida en el servidor.

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

Si no quieres deducirlo a mano, pulsa **Detectar configuración**: abre la URL y
propone los campos explicando en qué se basa. Revísalo antes de lanzar la
búsqueda, porque es una sugerencia y puede equivocarse.

Averiguar cómo pagina un sitio a mano también es sencillo: pasa a la página 2 y
mira qué cambia en su URL.

### Patrones de enlace

| Patrón                 | Qué hace                                           |
| ---------------------- | -------------------------------------------------- |
| _(vacío)_              | Coge todos los enlaces                             |
| `/videos/`             | El href original contiene ese texto                |
| `https://sitio.com/v/` | La URL absoluta empieza así                        |
| `gatos`                | La URL absoluta contiene ese texto                 |
| `/\/videos\/\d+/`      | Expresión regular: `/videos/` seguido de un número |

Un patrón se interpreta como expresión regular si va **entre barras y contiene
algún símbolo** (`\`, `^`, `$`, `\d`, `+`, …). `/videos/` a secas sigue siendo
texto literal, para que las configuraciones ya guardadas no cambien de
significado.

### Sitios con scroll infinito

Si el sitio no tiene botonera de páginas y va cargando al bajar, abre
**Paginación y opciones avanzadas** y elige el modo _scroll_. Entonces:

- Hace falta **Renderizar con navegador**: sin él no hay scroll que valga.
- El campo **Hasta** pasa a significar «número de cargas», no «número de
  páginas».
- La exploración para cuando dejan de aparecer resultados nuevos o cuando
  alcanza uno de los topes de seguridad. Si para por un tope, la interfaz lo
  dice: los resultados están incompletos.

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
