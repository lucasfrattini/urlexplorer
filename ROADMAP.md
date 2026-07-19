# URL Explorer — hoja de ruta

> Documento de propuesta. **Nada de aquí está implementado.**
>
> Continúa a `IDEAS.md`, que fue el análisis inicial. Lo que allí se propuso y
> ya está construido no se repite: autodetección de configuración, patrones
> con expresión regular, tamaño desde la ficha, scroll infinito, sistema de
> extensiones por sitio y modo admin están hechos. Aquí queda **lo que sigue
> pendiente de aquel análisis** más **lo que se ha aprendido usando la
> herramienta y trabajando en su código**, que es de donde salen casi todas
> las ideas nuevas.
>
> Los sitios se describen por sus características técnicas, nunca por su
> nombre. Los ejemplos usan `ejemplo.com`.

---

## Cómo leer esto

Cada propuesta lleva el problema real que resuelve, los módulos que tocaría,
el esfuerzo y —sobre todo— los riesgos. Los riesgos no son un formalismo: en
este proyecto casi todos los fallos caros han sido **silenciosos**, y varias
de estas ideas tienen exactamente esa forma.

**Herencia de `IDEAS.md`** (pendiente): QW-4 historial, QW-5 exportar en más
formatos, MS-2 reanudar y programar, MS-3 duplicados entre sitios, MS-4
reglas de extracción declarativas, AG-1 cola de descarga, AG-3 multiusuario
real. Se recogen abajo, actualizadas con lo que ahora se sabe del código.

---

## 1. Quick wins

### QW-A · Exportar en CSV, JSON y lista para gestores de descargas

_(viene de `IDEAS.md` QW-5, sin cambios de fondo)_

**Problema.** Sólo hay `.txt` con una URL por línea. Todo lo que la aplicación
ha averiguado —duración, peso, página de origen, si el fichero está sin
verificar, a qué grupo de duplicados pertenece— se tira al exportar. Para
llevarlo a una hoja de cálculo hay que rehacerlo a mano.

**Qué haría.** Tres botones junto a los actuales: CSV con todas las columnas,
JSON con la estructura completa, y una lista plana para gestores de descargas.

**Módulos.** `public/js/components/resultList.js`, `public/js/dom.js`
(`downloadText` ya existe y sirve tal cual). Ninguna ruta nueva: todo el dato
ya está en el cliente.

**Esfuerzo.** Muy bajo. Unas horas.

**Riesgos.** Ninguno serio. Un detalle: el CSV debe escapar comillas y comas
de las URLs, o una URL con `,` parte la fila y el fichero se lee mal en
silencio.

---

### QW-B · Reanudar la última exploración al recargar

_(evolución de `IDEAS.md` QW-4, acotada a lo que de verdad duele)_

**Problema.** Si se cierra la pestaña se pierde el crawl entero. El formulario
sí se recuerda en `sessionStorage`; los resultados no.

**Qué haría.** Guardar en `sessionStorage` el último resultado completo y
ofrecer «recuperar la última exploración» al abrir. Nada de historial largo:
sólo el último, que es el 90 % del valor con el 10 % del trabajo.

**Módulos.** `views/explorer.js`, `components/resultList.js`.

**Esfuerzo.** Bajo. Un día.

**Riesgos.** `sessionStorage` ronda los 5 MB; 5000 ficheros con metadatos se
acercan. Hay que topar y **decir que se ha topado**, no recortar en silencio.
Además, coherencia con la privacidad del proyecto: `sessionStorage` muere con
la pestaña, que es justo lo que se quiere; en `localStorage` sería un
historial de búsquedas persistente para la siguiente persona que se siente.

---

### QW-C · Cancelar la fase 2 conservando lo encontrado

**Problema.** Hoy «Cancelar» aborta y lo ya encontrado se queda en pantalla,
pero el resumen final no llega. Cuando la fase 2 va lenta, lo natural es
querer parar y quedarse con lo que haya.

**Qué haría.** Que el botón emita un `complete` con lo acumulado y marcado
como parcial, en vez de cortar el flujo sin cerrar.

**Módulos.** `routes/scrape.js` (SSE), `services/scraper.js`,
`components/progress.js`.

**Esfuerzo.** Bajo. Medio día.

**Riesgos.** Bajo. Hay que dejar clarísimo en la interfaz que el resultado es
parcial: presentarlo como completo sería exactamente el fallo silencioso que
el proyecto persigue.

---

### QW-D · Avisar cuando el patrón no casa con nada

**Problema.** Un patrón de enlace mal escrito devuelve cero resultados sin
distinguirse de «el sitio no tiene nada». Es el fallo más repetido al
configurar un sitio nuevo, y ya está documentado como tal.

**Qué haría.** Si se descargaron páginas pero el patrón dejó fuera el 100 % de
los enlaces, decirlo con el número: «se encontraron 240 enlaces y ninguno casa
con `/videos/`», y ofrecer los tres prefijos más frecuentes de la página.

**Módulos.** `services/scraper.js` (contar los descartados por patrón),
`views/explorer.js`.

**Esfuerzo.** Bajo. Un día.

**Riesgos.** Ninguno. Es diagnóstico puro, no cambia lo que se descarga.

---

### QW-E · Detectar el bloqueo anti-bot y decirlo

**Problema.** Los challenges anti-bot son la causa de fallo más común según el
propio análisis de `IDEAS.md` (cuatro de ocho sitios). Hoy se manifiestan como
«cero resultados» y el usuario no tiene forma de saber que le han bloqueado.

**Qué haría.** Reconocer las señales típicas en la respuesta (páginas de
verificación, ciertos códigos de estado, cuerpos característicos) y decir «este
sitio parece estar bloqueando peticiones automáticas; prueba con navegador».

**Módulos.** `lib/http.js` o un `lib/blocking.js` nuevo, `services/scraper.js`
para propagarlo, `views/explorer.js` para el aviso.

**Esfuerzo.** Bajo-medio. 1-2 días.

**Riesgos.** Falsos positivos: una página legítima puede parecerse a un
challenge. Debe presentarse como sospecha, nunca como certeza, igual que se
hizo con la propuesta de configuración.

---

## 2. Mejoras sustanciales

### MS-A · Trabajos con estado: reanudar, y no depender de la pestaña

_(viene de `IDEAS.md` MS-2; sigue siendo el cambio estructural más grande)_

**Problema.** El tope de 10 minutos mata crawls largos con navegador y no deja
nada aprovechable. Todo es síncrono: hay que tener la pestaña abierta.

**Qué haría.** Convertir el crawl en un trabajo con identidad: se lanza, se
consulta, se reanuda donde quedó, y sus resultados parciales sobreviven.

**Módulos.** Nuevo `services/jobs.js`; rutas nuevas; el SSE pasaría a **leer**
de un trabajo en vez de ejecutarlo; almacenamiento persistente.

**Esfuerzo.** Alto. Una semana.

**Riesgos.** Introduce estado en una aplicación que hoy no lo tiene, y con él
persistencia, limpieza y concurrencia. Choca con el rate limiting actual, que
asume una petición por acción. Y con el modelo de privacidad: los resultados
persistidos llevan nombres de sitios, así que tendrían que vivir donde
`data/`, fuera del control de versiones, y borrarse solos.

**Nota nueva desde el código.** La cancelación por `AbortSignal` ya está bien
resuelta y `crawl()` ya emite eventos; el salto no es la ejecución, es dónde
se guarda el progreso.

---

### MS-B · Reglas de extracción declarativas por sitio

_(viene de `IDEAS.md` MS-4, y ahora tiene un punto de anclaje claro)_

**Problema.** Hoy adaptar un sitio raro exige **escribir código**: una
extensión en `src/extensions/`. Está bien diseñado y es seguro, pero cargar
una extensión es ejecutarla, así que no se puede abrir a nadie más.

**Qué haría.** Un formato declarativo —JSON con selectores y transformaciones—
interpretado por el núcleo. Sin código ejecutable: se pueden guardar en
`data/`, editarse desde el modo admin y compartirse sin riesgo.

**Módulos.** Nuevo intérprete en `services/`; `services/extensions.js` como
referencia del contrato; modo admin para editarlas.

**Esfuerzo.** Alto. Una semana.

**Riesgos.** Un formato declarativo siempre se queda corto y la tentación de
añadirle «un campo para una expresión» acaba reinventando el código
ejecutable. Si se hace, la línea hay que defenderla: **un selector no es un
programa**. Es la respuesta correcta a «que un usuario aporte reglas»; relajar
la carga de extensiones NO lo es.

---

### MS-C · Duplicados entre exploraciones, no sólo dentro de una

_(viene de `IDEAS.md` MS-3)_

**Problema.** La agrupación actual sólo compara dentro de una exploración.
Repetir una búsqueda o explorar dos secciones que se solapan no dice qué ya se
tenía.

**Qué haría.** Guardar las huellas (nombre normalizado, duración, tamaño) de
lo ya visto y marcar los repetidos al explorar de nuevo.

**Módulos.** `lib/dedupe.js` ya tiene toda la lógica de señales; haría falta
persistencia y un punto donde consultarla.

**Esfuerzo.** Medio. 2-3 días sobre MS-A.

**Riesgos.** Depende de tener estado (MS-A). Y ojo con la privacidad: una base
de huellas es un historial de lo explorado, con lo que eso implica en una
máquina compartida.

**Nota nueva desde el código.** La comparación es O(n²) por diseño, porque la
tolerancia de tamaño no es una relación de equivalencia. Contra un histórico
creciente eso no escala: haría falta una clave de agrupación previa (por
ejemplo el nombre normalizado) y aceptar que se pierden algunos emparejamientos
que hoy sí se hacen. Es un trade-off consciente, no un detalle de
implementación.

---

### MS-D · Vista previa antes de descargar

**Problema.** La aplicación entrega URLs. Decidir si un fichero es el bueno
exige abrirlo una por una, y con vídeos de vista previa mezclados eso es
justamente lo difícil.

**Qué haría.** Miniatura y datos básicos por resultado, tomados del `poster`
o del `og:image` que ya aparecen en el HTML que la fase 2 descarga.

**Módulos.** `lib/media.js` (extraer el poster, ya se extrae duración y
tamaño del mismo HTML), `components/resultList.js`.

**Esfuerzo.** Medio. 2-3 días.

**Riesgos.** Cargar imágenes de terceros desde el navegador del usuario
**rompe el modelo de privacidad**: revela su IP a cada CDN y obliga a relajar
la CSP (`img-src` hoy es `'self' data:`). Si se hace, debería ser opt-in y
explicando qué implica; o servir las miniaturas por el backend, que las cachea
y no expone al cliente. La segunda es más trabajo y la correcta.

---

## 3. Apuestas grandes

### AG-A · Cola de descarga integrada

_(viene de `IDEAS.md` AG-1)_

**Problema.** La herramienta encuentra ficheros; descargarlos es otro programa.

**Qué haría.** Una cola en el servidor: elegir resultados, encolarlos, ver
progreso, reanudar cortes.

**Módulos.** Todo nuevo: servicio de descargas, almacenamiento, rutas, UI.
Reutilizaría `lib/http.js` y el throttle por dominio.

**Esfuerzo.** Muy alto. Semanas.

**Riesgos.** Cambia lo que la aplicación **es**: pasa de explorar a almacenar,
con todo lo que eso arrastra (espacio en disco, límites, responsabilidad sobre
el contenido guardado). Antes de esto conviene tener MS-A, porque una descarga
es un trabajo con estado y sería la segunda implementación del mismo concepto
si se hace al revés.

---

### AG-B · Multiusuario de verdad

_(viene de `IDEAS.md` AG-3)_

**Problema.** El modo admin es un gate para que la herramienta aparezca en
blanco, no un sistema de usuarios. Está dicho abiertamente y es honesto, pero
limita el uso a una máquina compartida por gente que se conoce.

**Qué haría.** Usuarios, sesiones, permisos y perfiles por usuario.

**Módulos.** Prácticamente todo el backend; `middleware/adminAuth.js`
desaparecería en favor de autenticación real.

**Esfuerzo.** Muy alto.

**Riesgos.** Es un cambio de producto, no de código. Multiplica la superficie
de ataque de una aplicación que hoy es deliberadamente pequeña, y obliga a
tomarse en serio cosas que ahora se pueden ignorar con razón (rotación de
credenciales, auditoría, aislamiento entre usuarios). **Sólo tiene sentido si
la herramienta sale de la máquina donde está.** Si sigue siendo local, añade
riesgo sin añadir valor.

---

### AG-C · Aprender del uso para proponer mejores configuraciones

**Problema.** La detección acierta la mayoría de las veces, no siempre, y no
mejora nunca: cada análisis empieza de cero aunque el mismo sitio se haya
configurado veinte veces.

**Qué haría.** Registrar qué configuraciones acabaron funcionando —cuáles se
guardaron como perfil y dieron ficheros— y usarlas para afinar la propuesta
del detector en sitios de estructura parecida.

**Módulos.** `services/detector.js`, almacenamiento de resultados (MS-A),
`services/profiles.js`.

**Esfuerzo.** Alto, y de resultado incierto.

**Riesgos.** El mayor es de **presentación**: una propuesta «que aprende»
invita a confiar sin revisar, y la regla que ya está escrita en el proyecto es
que la detección se presente siempre como sugerencia editable. Un sistema que
acierta el 85 % y se presenta como automático es peor que uno que acierta el
70 % y se presenta como propuesta. Además, el registro es un historial de
sitios explorados, con el mismo problema de privacidad que MS-C.

---

## 4. Deuda técnica que conviene pagar antes

No son funcionalidades, pero condicionan varias de las de arriba.

| Deuda                                                                     | Por qué bloquea                                                                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin CI**                                                                | `npm run check` existe y nadie lo ejecuta solo. Con más superficie, la suite deja de ser una red                                                                      |
| **Rate limiting en memoria**                                              | No vale para varias instancias; MS-A y AG-B lo exigen compartido                                                                                                      |
| **`services/scraper.js` mezcla fases y orquestación**                     | `findFiles` hace descarga, licencia, relevancia, metadatos y pesos en un solo bucle. Tocarlo para MS-A sería tocarlo todo                                             |
| **Extracción HTML repetida por ficha**                                    | Se parsea el mismo documento varias veces por página de detalle (licencia, duración, tamaño). Pasar un documento ya parseado ahorraría trabajo y quitaría duplicación |
| **`video.js` y `media.js` con formateadores duplicados y ya divergentes** | `formatDuration`/`formatFileSize` existen en los dos y no se comportan igual. Cualquier vista que combine ambos mostrará números distintos para el mismo dato         |
| **Scroll infinito sin test automático**                                   | Exige navegador real. Es la parte más frágil y la única sin red de seguridad                                                                                          |

---

## 5. Si hubiera que elegir tres

1. **QW-D + QW-E** (avisar cuando el patrón no casa, y detectar bloqueo).
   Juntos atacan la causa número uno de frustración: cero resultados sin
   explicación. Son días, no semanas, y no tocan la arquitectura.
2. **QW-A** (exportar en más formatos). El dato ya está en el cliente; es de
   las pocas cosas con relación esfuerzo/valor casi absurda.
3. **MS-A** (trabajos con estado). Es el que desbloquea MS-C, AG-A y el que
   quita el techo de los 10 minutos. Caro, pero es el único cambio estructural
   que el resto está esperando.

Lo que **no** elegiría todavía: AG-B. Mientras la herramienta viva en una
máquina compartida por gente que se conoce, el gate actual es proporcionado y
un sistema de usuarios sólo añadiría superficie.
