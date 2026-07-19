# URL Explorer — análisis y propuesta de funcionalidades

> Documento de análisis. Ninguna de estas propuestas está implementada.
> Los sitios investigados se identifican por letra y por sus características
> técnicas, no por su nombre.

---

## 1. Dónde está hoy la aplicación

### Lo que hace bien

- Recorre paginación por query string (`?page=N`) y por plantilla en la URL
  (`/page/{page}`, `{page:02}`), con el término de búsqueda parametrizado (`{q}`).
- Extrae enlaces por patrón y ficheros por extensión real del pathname.
- Renderiza con navegador en las dos fases, con pool de pestañas reutilizadas.
- Progreso en tiempo real por SSE con cancelación efectiva.
- Extrae duración desde el HTML de la ficha, sin peticiones extra.

### Dónde se rompe

Los límites reales no son teóricos: salieron de intentar configurar sitios
concretos. Se investigaron ocho que no se pudieron dejar funcionando.

| Sitio | Paginación                          | Fichas         | Obstáculo                                                               |
| ----- | ----------------------------------- | -------------- | ----------------------------------------------------------------------- |
| **A** | `?page=N` correcta                  | `/videos`      | Challenge anti-bot; sin navegador devuelve 0                            |
| **B** | `/search/{page}/?q=` correcta       | `/videos`      | Challenge anti-bot; el patrón simple también captura `/members`         |
| **C** | por path                            | —              | El sitio tarda más de 30 s en responder: agota el timeout de navegación |
| **D** | AJAX interno (motor de tubes común) | `/videos`      | Challenge anti-bot                                                      |
| **E** | **por path** `/tag/{q}/{page}/`     | —              | **Ninguno real: el motor ya lo soporta, faltaba la configuración**      |
| **F** | scroll infinito                     | —              | No hay URL de página; el motor no puede avanzar                         |
| **G** | scroll infinito                     | `/v`, `/video` | Ídem                                                                    |
| **H** | AJAX + scroll infinito              | `/videos`      | Challenge anti-bot + scroll                                             |

Tres patrones de fallo, y ninguno es "el sitio es raro":

1. **Scroll infinito (F, G, H)** — el motor asume que existe una URL por página.
   Es la carencia más profunda: no es un ajuste de configuración, es una
   capacidad que falta.
2. **Challenges anti-bot (A, B, D, H)** — se detectó `cdn-cgi/challenge-platform`
   en cuatro de los ocho. Con navegador suelen pasar; sin él, cero resultados.
3. **Patrón de enlace demasiado grosero (B)** — `includes()` sobre la URL no
   distingue `/videos/12345/` de `/videos/categoria/`.

Y uno que no era un obstáculo: **E ya es viable hoy**. Su paginación por path
encaja con `{page}`; simplemente nunca se probó esa forma.

---

## 2. Quick wins

### QW-1 · Autodetección de la configuración de un sitio

**Problema.** Configurar un sitio exige abrir devtools, mirar la red, pulsar
"página 2", copiar una URL e inferir el patrón de enlaces. Es el mayor coste de
entrada de toda la herramienta y hoy lo resuelve una persona a mano cada vez.

**Qué haría.** Un endpoint que recibe una URL de búsqueda, la abre con el
navegador, y devuelve una propuesta de configuración: mecanismo de paginación
detectado, patrón de enlaces sugerido, si hace falta navegador y qué
extensiones aparecen. El formulario se rellena solo y la persona ajusta.

Es exactamente el procedimiento manual que se aplicó a ocho sitios en este
análisis; automatizarlo es directo porque las señales son estables: enlaces con
texto numérico, `rel="next"`, XHR al pulsar la página 2, segmento de ruta más
repetido entre enlaces con id numérico.

**Módulos.** Nuevo `src/services/detector.js`; nueva ruta en
`src/routes/scrape.js`; botón "Detectar configuración" en `views/explorer.js`.
Reutiliza `lib/browser.js` y `lib/url.js` tal cual.

**Esfuerzo.** Medio-bajo. 1-2 días.

**Riesgos.** La detección acertará quizá el 70 % de las veces; hay que
presentarla como _sugerencia editable_, nunca como verdad. Si se presenta como
automática, cada fallo se leerá como avería. Coste: una carga con navegador por
detección.

---

### QW-2 · Patrones de enlace con expresión regular

**Problema.** El sitio B trae 201 enlaces pero mezcla fichas de vídeo con
páginas de miembros, porque el patrón es `includes()`. No hay forma de decir
"`/videos/` seguido de un número".

**Qué haría.** Si el patrón empieza y acaba con `/`, interpretarlo como regex:
`/^\/videos\/\d+/`. Todo lo demás sigue igual.

**Módulos.** `services/scraper.js` (`extractMatchingLinks`), más ayuda en la UI.

**Esfuerzo.** Bajo. Medio día con tests.

**Riesgos.** Una regex mal escrita puede ser catastrófica en backtracking
(ReDoS) sobre miles de enlaces. Mitigable: compilar una vez, limitar longitud
del patrón, y envolver en un tope de tiempo.

---

### QW-3 · Tamaño de fichero desde la ficha

**Problema.** La casilla de tamaño usa `HEAD`, y en varios sitios las URLs de
fichero responden con un 302 hacia una dirección con token que no devuelve
`content-length`. La columna queda vacía justo donde más se necesita:
distinguir un vídeo completo de un clip de vista previa de 180 KB.

**Qué haría.** Extraer el tamaño del HTML de la ficha, igual que ya se hace con
la duración: muchos sitios lo muestran en pantalla ("245 MB"). Se usaría como
respaldo cuando el `HEAD` no devuelva nada.

**Módulos.** `lib/media.js` (añadir `extractSize`), `services/scraper.js`.

**Esfuerzo.** Bajo. Medio día.

**Riesgos.** Ninguno serio. El dato es orientativo, no exacto; conviene marcarlo
como aproximado cuando venga del HTML.

---

### QW-4 · Historial de exploraciones

**Problema.** Cada búsqueda arranca de cero. Si se cierra la pestaña sin copiar
los resultados, se pierden veinte minutos de crawl.

**Qué haría.** Guardar las últimas N exploraciones (configuración + resultados)
y poder reabrirlas. Al principio en el navegador; con el modo admin, en el
servidor.

**Módulos.** Nuevo componente de UI; con backend, nueva ruta y almacenamiento.

**Esfuerzo.** Bajo si es sólo en el navegador; medio con backend.

**Riesgos.** Los resultados pueden ser miles de URLs: hay que topar el tamaño
para no llenar el almacenamiento del navegador.

---

### QW-5 · Exportar en más formatos

**Problema.** Sólo hay `.txt`. Para usar los resultados con un gestor de
descargas o una hoja de cálculo hay que reformatear a mano.

**Qué haría.** Exportar a CSV (con duración, tamaño y página de origen), JSON, y
un fichero de lista compatible con gestores de descargas.

**Módulos.** `public/js/dom.js` (`downloadText` ya existe), `resultList.js`.

**Esfuerzo.** Muy bajo. Unas horas.

**Riesgos.** Ninguno.

---

## 3. Mejoras sustanciales

### MS-1 · Soporte de scroll infinito

**Problema.** Tres de los ocho sitios investigados (F, G, H) no tienen URL por
página: cargan más resultados al bajar. Hoy el motor sólo puede traer la
primera pantalla. Es el límite que más sitios deja fuera.

**Qué haría.** Un modo de paginación nuevo, junto a "parámetro" y "plantilla":
_scroll_. En vez de pedir N URLs, abre una sola página con navegador y hace
scroll repetido hasta que deje de aparecer contenido nuevo o se alcance un
tope. El "número de páginas" pasa a ser "número de cargas".

Encaja mejor de lo que parece: `lib/browser.js` ya tiene `autoScroll` con tope
de tiempo; hay que convertirlo en un bucle que observe si crece el número de
enlaces.

**Módulos.** `lib/browser.js` (scroll incremental con observación),
`services/scraper.js` (`collectLinks` con tercer modo), UI para elegir modo.

**Esfuerzo.** Medio-alto. 3-4 días con pruebas contra sitios reales.

**Riesgos.** Es intrínsecamente más lento y menos predecible: no se sabe cuánto
falta. Consume una pestaña del pool durante toda la fase 1. Hay que fijar topes
duros de tiempo y de elementos, o un sitio con scroll ilimitado bloquea el pool.
Deuda: tres modos de paginación conviviendo complican `collectLinks`, que hoy
es simple; conviene extraer una estrategia por modo antes de que crezca más.

---

### MS-2 · Reanudar y programar exploraciones

**Problema.** Un crawl con navegador sobre cientos de enlaces supera los 10
minutos de tope y muere sin dejar nada aprovechable. Además, todo es síncrono:
hay que tener la pestaña abierta.

**Qué haría.** Convertir el crawl en un trabajo con estado: se lanza, se
consulta su progreso, se puede reanudar donde quedó y se conservan los
resultados parciales. Encima de eso, programarlos.

**Módulos.** Nuevo `src/services/jobs.js`; rutas nuevas; el SSE pasaría a leer
del trabajo en vez de ejecutarlo; almacenamiento persistente.

**Esfuerzo.** Alto. Una semana.

**Riesgos.** Es el cambio arquitectónico más grande de la lista: introduce
estado en una app que hoy no lo tiene, y con ello persistencia, limpieza y
concurrencia. Choca de frente con el rate limiting actual, que asume una
petición por acción. Yo lo dejaría para después de tener QW-1 y MS-1.

---

### MS-3 · Deduplicación y detección de duplicados entre sitios

**Problema.** El mismo vídeo aparece en varios sitios agregadores. Hoy se
descarga la lista con duplicados y se filtran a mano.

**Qué haría.** Normalizar y comparar por señales estables (duración exacta,
tamaño, nombre de fichero normalizado) y agrupar resultados equivalentes.

**Módulos.** Nuevo `lib/dedupe.js`, `services/scraper.js`, agrupación en la UI.

**Esfuerzo.** Medio. 2-3 días.

**Riesgos.** Los falsos positivos son peores que los duplicados: dos vídeos
distintos de la misma duración se agruparían. Debe ser agrupación visual
reversible, nunca descarte silencioso.

---

### MS-4 · Perfiles por sitio con reglas de extracción

**Problema.** Hoy un perfil es sólo una URL más unos campos. Los sitios que
fallan necesitan más: un selector concreto para las fichas, saber que hay que
seguir una redirección, o que el fichero está en un atributo no estándar.

**Qué haría.** Ampliar el perfil con reglas opcionales: selector CSS para los
enlaces, atributos adicionales donde buscar el fichero, y transformaciones de
URL. Los perfiles pasan de configuración a pequeñas recetas.

**Módulos.** `services/scraper.js` (aceptar selector además de patrón),
esquema de perfil, UI avanzada.

**Esfuerzo.** Medio. 3 días.

**Riesgos.** Es el punto donde la herramienta deja de ser genérica y empieza a
acumular casos particulares. Cada regla nueva es deuda: hay que resistir la
tentación de añadir una por sitio. Conviene aceptar sólo reglas que sirvan a
más de un sitio.

---

## 4. Apuestas grandes

### AG-1 · Cola de descarga integrada

**Qué sería.** Hoy la herramienta entrega URLs; descargarlas es cosa de otro
programa. Integrar una cola con reanudación, límite de velocidad y control de
concurrencia cerraría el ciclo.

**Esfuerzo.** Muy alto. Cambia la naturaleza del proyecto: de explorador a
gestor de descargas.

**Trade-offs honestos.** Es la propuesta con más implicaciones no técnicas.
Explorar y listar enlaces públicos es una cosa; descargar en masa de forma
automatizada es otra, y la mayoría de sitios lo prohíben expresamente en sus
condiciones. Además obliga a gestionar almacenamiento, espacio en disco y
limpieza, que hoy no existen. **Mi recomendación es no construirlo**: existen
gestores de descarga maduros y dedicados, y la herramienta aporta más siendo
buena en lo suyo y entregando una lista limpia.

---

### AG-2 · Sistema de extensiones por sitio

**Qué sería.** En vez de acumular casos particulares en el núcleo (MS-4), un
sistema donde cada sitio problemático se resuelve con un módulo aislado que
implementa una interfaz conocida (`listar(pagina)`, `extraerFicheros(html)`).

**Esfuerzo.** Alto. Requiere diseñar la interfaz y un cargador seguro.

**Trade-offs.** Es la respuesta correcta _si_ el número de sitios con
particularidades sigue creciendo. Si se queda en unos pocos, es
sobreingeniería: MS-4 resuelve lo mismo con mucho menos. La decisión debería
tomarse cuando haya cinco o seis sitios que no encajen, no antes. Riesgo serio:
si las extensiones son código, cargarlas es ejecutar código arbitrario.

---

### AG-3 · Modo multiusuario real

**Qué sería.** Cuentas, permisos y configuraciones por persona, para desplegarlo
como servicio.

**Trade-offs.** Contradice de plano el escenario real de uso descrito en la
funcionalidad B: varias personas en el mismo ordenador y navegador. Introduce
gestión de sesiones, contraseñas y superficie de ataque para resolver un
problema que hoy no existe. **No recomendado** salvo que el despliegue cambie a
red compartida.

---

## 5. Funcionalidad A · Configurar los sitios que hoy fallan

### Viables ya, sin tocar el motor

- **Sitio E** — Pagina por path (`/tag/{q}/{page}/`). El motor ya lo soporta con
  la plantilla `{page}`. Sólo falta escribir el perfil y verificarlo. _Coste:
  minutos._
- **Sitio A** — Su paginación por query string es correcta; falló por el
  challenge anti-bot. Con navegador activado debería funcionar. _Coste: una
  verificación._
- **Sitio B** — Paginación correcta por path. Necesita navegador y un patrón más
  fino para no arrastrar páginas de miembros: se resuelve hoy con un patrón más
  específico, y mejor aún con QW-2. _Coste: bajo._
- **Sitio D** — Usa el mismo motor de tubes que otro perfil ya incluido, con la
  misma URL interna de paginación. Debería salir con navegador. _Coste: bajo._

### Viables con trabajo

- **Sitio C** — No hay problema de diseño: el sitio tarda más de 30 s en
  responder. Se resuelve subiendo `BROWSER_NAVIGATION_TIMEOUT_MS` para ese
  perfil. Hoy el timeout es global, así que haría falta permitirlo por perfil.
  _Coste: bajo, pero toca configuración._

### No viables sin MS-1

- **Sitios F, G, H** — Scroll infinito. No hay nada que configurar: falta la
  capacidad en el motor. **Con MS-1 implementado, los tres pasan a ser viables.**

### Recomendación sobre generalizar o hacer perfiles a medida

**Generalizar, con una excepción.** Cinco de los ocho encajan en lo que el motor
ya sabe hacer o casi (patrón más fino, timeout por perfil). Los otros tres
comparten _una sola_ carencia —scroll infinito— que además reaparecerá en
cualquier sitio moderno. Añadir un tercer modo de paginación es generalización
legítima: sirve a muchos sitios, no a uno.

Lo que **no** haría es empezar a escribir código por sitio. En cuanto una regla
sirve a un solo sitio, deja de ser una funcionalidad y pasa a ser deuda con
nombre propio.

---

## 6. Funcionalidad B · Modo admin para las configuraciones guardadas

### El problema real

Varias personas usan la herramienta en el mismo ordenador, mismo navegador,
misma sesión física. Hoy las configuraciones guardadas viven en el navegador y
los perfiles incluidos están escritos en el JavaScript que se sirve a todo el
mundo: cualquiera que abra la aplicación los ve.

El objetivo no es seguridad frente a un atacante: es que **en el uso normal la
herramienta aparezca en blanco** y nadie más pueda guardar nada.

### Estado actual (lo que hay que mover)

| Qué                     | Dónde está hoy                                             | Problema                                                |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Perfiles incluidos      | `public/js/components/profiles.js`, constante en el código | Se sirven a todo el mundo y **están en el repositorio** |
| Perfiles del usuario    | `localStorage` del navegador                               | Compartidos entre todas las personas del equipo         |
| Último formulario usado | `localStorage`                                             | Ídem: la siguiente persona ve la última búsqueda        |

> ⚠️ Los perfiles incluidos están hoy en un fichero versionado. Cualquier
> publicación del repositorio los expone. Moverlos al backend es parte de esta
> funcionalidad, pero conviene tratarlo como urgente e independiente.

### Diseño propuesto

**Backend**

- `src/config/index.js` — leer `ADMIN_TOKEN`. Vacío ⇒ modo admin deshabilitado
  y la aplicación funciona sin configuraciones guardadas para nadie.
- `src/middleware/adminAuth.js` (nuevo) — comprueba la cabecera
  `X-Admin-Token` contra `config.admin.token` con **comparación en tiempo
  constante** (`crypto.timingSafeEqual`) para no filtrar el token por tiempos de
  respuesta. Devuelve 401 si no coincide.
- `src/services/profiles.js` (nuevo) — carga y guarda los perfiles en el
  servidor, en un fichero JSON bajo un directorio de datos **fuera del control
  de versiones** (`data/profiles.json`, añadido a `.gitignore`). Los perfiles
  incluidos se trasladan aquí como semilla inicial.
- `src/routes/admin.js` (nuevo):
  - `POST /api/admin/unlock` — recibe el token, responde 200/401. Con rate
    limiting **más estricto** que el resto (por ejemplo 5 intentos por minuto):
    es el único endpoint donde tiene sentido intentar fuerza bruta.
  - `GET /api/admin/profiles` — devuelve los perfiles. Requiere token.
  - `PUT /api/admin/profiles` — guarda. Requiere token.
- Ningún endpoint público devuelve perfiles. Sin desbloqueo, la aplicación
  responde igual que si no existieran.

**Frontend**

- `public/js/components/profiles.js` — se vacía de datos: pasa a pedirlos al
  backend. La constante con los sitios desaparece del código servido.
- Por defecto: sin desplegable de configuraciones, **sin botón de guardar**.
- Gesto oculto de desbloqueo: **pulsar cinco veces seguidas el logo de la
  cabecera en menos de dos segundos**. Elegido frente a las alternativas
  porque no aparece en ningún menú, no se descubre inspeccionando el HTML (no
  hay ningún elemento ni texto que lo insinúe), no colisiona con atajos del
  navegador y funciona igual en móvil. Una secuencia tipo Konami es más
  divertida pero se dispara sola al teclear en campos de texto; un atajo
  `Ctrl+Shift+algo` puede chocar con el navegador y es lo primero que alguien
  prueba.
- Al completarse el gesto, un diálogo pide la contraseña y la valida contra
  `/api/admin/unlock`.
- Con el desbloqueo superado: el token se guarda en **`sessionStorage`** y se
  envía en `X-Admin-Token`. Al cerrar la pestaña desaparece. Nunca
  `localStorage` ni cookies.
- El formulario deja de recordarse en `localStorage`: pasa a `sessionStorage`,
  para que la siguiente persona no vea la última búsqueda.

### Límites, dichos claramente

- Con acceso físico compartido, nada impide que alguien mire mientras se
  escribe la contraseña, o que abra devtools y lea el `sessionStorage` mientras
  la sesión está desbloqueada. **Esto no es un control de seguridad frente a
  alguien decidido**; es un gate para que en el uso normal la herramienta
  aparezca vacía.
- Lo que sí garantiza el diseño: los perfiles **no están en el código servido**,
  así que husmear el frontend no los revela; y el guardado se valida **en el
  servidor**, así que ocultar el botón no es la única defensa.
- Quien tenga acceso al fichero `.env` del servidor tiene el token. Es
  inevitable en un despliegue local y conviene asumirlo.

**Módulos tocados.** Backend: `config/`, `middleware/adminAuth.js` (nuevo),
`services/profiles.js` (nuevo), `routes/admin.js` (nuevo), `routes/index.js`,
`app.js`. Frontend: `components/profiles.js` (reescritura), `views/explorer.js`,
`api.js`, `app.js`. Más `.gitignore` y `.env.example`.

**Esfuerzo.** Medio. 2-3 días con tests del middleware y del gate.

**Riesgos.** El estado "desbloqueado / bloqueado" se propaga por toda la vista
del explorador; si no se centraliza, aparecerán fallos de UI donde el botón de
guardar quede visible sin permiso. Conviene un único punto que exponga el
estado y que todo lo demás lo consulte.

---

## 7. Recomendación priorizada

Si tuviera que elegir tres, por este orden:

### 1º · Funcionalidad B — Modo admin

No por seguridad, sino porque **hoy hay datos privados en un fichero
versionado**. Es lo único de esta lista que tiene un problema activo, no una
mejora pendiente. Además desbloquea publicar el repositorio con tranquilidad,
que es un objetivo declarado.

### 2º · QW-1 — Autodetección de configuración

Es el mayor multiplicador de la lista. Todo el trabajo manual de este análisis
—abrir devtools, pulsar página 2, copiar la URL interna, deducir el patrón— es
justo lo que automatiza. Convierte "configurar un sitio nuevo" de quince
minutos de trabajo experto a un botón. Y se apoya entera en piezas que ya
existen.

### 3º · MS-1 — Scroll infinito

Es la única carencia estructural que deja sitios enteros fuera del alcance de la
herramienta. Tres de los ocho investigados, y creciendo: es el patrón dominante
en sitios modernos. Con esto, los ocho pasan a estar cubiertos o al alcance.

**Fuera del podio a propósito:** MS-2 (reanudar) es valioso pero es el cambio
arquitectónico más grande y conviene hacerlo cuando el motor ya no vaya a
cambiar. Y AG-1 (cola de descargas) no lo construiría: cambia la naturaleza del
proyecto y hay herramientas dedicadas que lo hacen mejor.

### Antes de todo lo anterior

Dos cosas pequeñas que no son funcionalidades pero condicionan lo demás:

1. Sacar los perfiles del código versionado (parte de B, pero se puede hacer ya).
2. Verificar los cuatro sitios que ya son viables (A, B, D, E): es
   configuración, no desarrollo, y amplía la cobertura hoy mismo.
