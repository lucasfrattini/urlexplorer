/**
 * Diccionario en español.
 *
 * REGLAS AL AÑADIR UNA CADENA:
 *  - La clave va en `es.js` Y en `en.js`. Hay un test que falla si falta en
 *    uno de los dos, porque una traducción olvidada no da ningún error: se
 *    ve la frase en el otro idioma y parece que el selector no funciona.
 *  - Los huecos son `{nombre}`, nunca concatenación.
 *  - Para singular/plural, dos claves `.uno` y `.varios`, y se usa `tp()`.
 *  - Nada de HTML aquí dentro: todo entra por textContent.
 */
export const es = {
  /* ── Cabecera y navegación ─────────────────────────────────────── */
  'app.subtitulo': 'Explora enlaces y recursos de un sitio',
  'app.saltar': 'Saltar al contenido',
  'nav.aria': 'Herramientas',
  'nav.explorador': 'Explorador',
  'nav.videos': 'Vídeos',
  'tema.cambiar': 'Cambiar tema',
  'tema.actual': 'Tema: {modo}',
  'tema.modo.system': 'automático',
  'tema.modo.light': 'claro',
  'tema.modo.dark': 'oscuro',
  'idioma.aria': 'Idioma',
  'idioma.es': 'Español',
  'idioma.en': 'Inglés',
  'idioma.cambiado': 'Idioma: español',

  /* ── Estado del servicio ───────────────────────────────────────── */
  'salud.comprobando': 'Comprobando servicio…',
  'salud.activo': 'Servicio activo · navegador {estado} · máx. {paginas} páginas por búsqueda',
  'salud.navegador.disponible': 'disponible',
  'salud.navegador.desactivado': 'desactivado',
  'salud.error': 'No se pudo contactar con el servidor. Se usan los límites por defecto.',

  /* ── Errores de red ────────────────────────────────────────────── */
  'api.sinConexion': 'No se pudo contactar con el servidor: {mensaje}',
  'api.errorHttp': 'Error {status}',
  'api.sseCaida': 'Se perdió la conexión con el servidor durante la búsqueda.',

  /* ── Copiar / portapapeles ─────────────────────────────────────── */
  'copiar.estaUrl': 'Copiar esta URL',
  'copiar.urlCopiada': 'URL copiada',
  'copiar.fallo': 'No se pudo copiar',

  /* ── Modo admin ────────────────────────────────────────────────── */
  'admin.contrasena': 'Contraseña:',
  'admin.desbloqueadas': 'Configuraciones desbloqueadas',
  'admin.bloqueadas': 'Configuraciones bloqueadas',
  'admin.incorrecta': 'Contraseña incorrecta',
  'admin.demasiados': 'Demasiados intentos. Espera un minuto.',

  /* ── Barra de configuraciones ──────────────────────────────────── */
  'perfiles.etiqueta': 'Configuración',
  'perfiles.aria': 'Configuraciones guardadas',
  'perfiles.elige': '— Elige una configuración —',
  'perfiles.guardar': 'Guardar',
  'perfiles.borrar': 'Borrar',
  'perfiles.copiarEnlace': 'Copiar enlace',
  'perfiles.copiarEnlace.title': 'Copia un enlace que abre la app con esta configuración',
  'perfiles.enlaceCopiado': 'Enlace copiado al portapapeles',
  'perfiles.cargada': 'Configuración de «{nombre}» cargada',
  'perfiles.nombrePrompt': 'Nombre para esta configuración:',
  'perfiles.nombreVacio': 'El nombre no puede estar vacío',
  'perfiles.guardado': '«{nombre}» guardado',
  'perfiles.confirmarBorrado': '¿Borrar la configuración «{nombre}»?',
  'perfiles.borrado': '«{nombre}» borrado',
  'perfiles.noGuardado': 'No se pudo guardar: {mensaje}',
  'perfiles.noCargadas': 'No se pudieron cargar las configuraciones: {mensaje}',

  /* ── Progreso ──────────────────────────────────────────────────── */
  'progreso.fase1': '1 · Recorrer páginas',
  'progreso.fase2': '2 · Buscar ficheros',
  'progreso.enEspera': 'En espera',
  'progreso.cancelar': 'Cancelar',
  'progreso.ficherosAria': 'Ficheros encontrados',
  'progreso.descargando': 'Descargando la primera página…',
  'progreso.paginaDe': 'Página {actual} de {total} · {enlaces} enlaces',
  'progreso.topeAlcanzado': ' (tope alcanzado)',
  'progreso.resumenFase1.uno': '{enlaces} enlaces en {n} página{sufijo}',
  'progreso.resumenFase1.varios': '{enlaces} enlaces en {n} páginas{sufijo}',
  'progreso.analizando': 'Analizando {total} páginas…',
  'progreso.deTotal': '{actual} de {total} · {url}',
  'progreso.hallados.uno': '{n} fichero encontrado',
  'progreso.hallados.varios': '{n} ficheros encontrados',
  'progreso.cancelada': 'Búsqueda cancelada',

  /* ── Filtros de rango ──────────────────────────────────────────── */
  'rango.minimo': '{label}, mínimo',
  'rango.maximo': '{label}, máximo',
  'rango.sinDatos': 'sin datos',

  /* ── Lista de resultados ───────────────────────────────────────── */
  'resultados.titulo': 'Resultados',
  'resultados.cero': '0 resultados',
  'resultados.total.uno': '{n} resultado',
  'resultados.total.varios': '{n} resultados',
  'resultados.mostrando': 'mostrando {visibles} de {total}',
  'resultados.plegados': '{n} plegados por duplicado',
  'resultados.copiar': 'Copiar',
  'resultados.descargar': 'Descargar .txt',
  'resultados.copiados': '{n} enlaces copiados',
  'resultados.noCopiado': 'No se pudo copiar al portapapeles',
  'resultados.descargados': '{n} enlaces descargados',
  'resultados.sinCoincidencias': 'Sin coincidencias',
  'resultados.sinCoincidencias.texto':
    'Ningún resultado pasa los filtros actuales. Prueba a ampliar los rangos o a desactivar los interruptores.',
  'resultados.noObtenido': 'No se pudo obtener {dato}',
  'resultados.dudoso': '⚠ sin verificar',
  'resultados.dudoso.title': 'No se pudo comprobar que este fichero sea el de la página.',
  'resultados.dudoso.titleMotivo':
    '{motivo}. Su duración no se muestra porque la de la ficha pertenece a otro vídeo.',
  'resultados.duplicados.title': 'Se han agrupado {n} resultado(s) más por {motivo}: {miembros}',
  'resultados.duplicados.motivoPorDefecto': 'señales coincidentes',
  'resultados.pesoAprox': 'Peso aproximado, tomado de la ficha del sitio',
  'resultados.pesoExacto': 'Peso exacto, informado por el servidor',
  'resultados.primeros':
    'Se muestran los primeros {n} de {total}. Descarga el .txt para verlos todos.',

  'columnas.enlace': 'Enlace',
  'columnas.duracion': 'Duración',
  'columnas.peso': 'Peso',

  'filtros.buscar': 'Filtrar resultados…',
  'filtros.buscar.aria': 'Filtrar resultados',
  'filtros.excluir': 'Ocultar los que contengan… (240p, sample)',
  'filtros.excluir.aria': 'Ocultar resultados que contengan estos textos',
  'filtros.excluir.title': 'Separa varios textos con comas',
  'filtros.ordenar.aria': 'Ordenar resultados',
  'filtros.orden.aparicion': 'Orden de aparición',
  'filtros.orden.duracion': 'Más largos primero',
  'filtros.orden.tamano': 'Más pesados primero',
  'filtros.ocultarSinDuracion': 'Ocultar sin duración',
  'filtros.ocultarSinDuracion.title':
    'Quita los resultados de los que no se pudo averiguar la duración. El filtro de rango por sí solo NO los quita.',
  'filtros.ocultarSinPeso': 'Ocultar sin peso',
  'filtros.ocultarSinPeso.title':
    'Quita los resultados de los que no se pudo averiguar el peso. El filtro de rango por sí solo NO los quita.',
  'filtros.agrupar.uno': 'Agrupar {n} duplicado',
  'filtros.agrupar.varios': 'Agrupar {n} duplicados',
  'filtros.agrupar.title':
    'Agrupa los resultados que parecen el mismo contenido. Desactívalo para verlos todos.',
  'filtros.nota':
    'Los rangos solo recortan entre los resultados que tienen el dato. A los que no lo tienen no los toca: para quitarlos, usa los interruptores.',
  'filtros.sinPeso':
    'Ningún resultado trae el peso. Se obtiene activando «Averiguar cuánto pesa cada archivo» en los ajustes avanzados, antes de explorar.',

  /* ── Explorador: cabecera ──────────────────────────────────────── */
  'explorer.titulo': 'Recorrer un sitio página a página',
  'explorer.subtitulo':
    'Pasa por las páginas de una sección y te devuelve lo que encuentre. Tres pasos.',
  'explorer.vacio.titulo': 'Todavía no hay resultados',
  'explorer.vacio.texto': 'Rellena los tres pasos y pulsa «Empezar a explorar».',

  /* ── Explorador: paso 1 ────────────────────────────────────────── */
  'explorer.paso1.titulo': '¿Qué página quieres recorrer?',
  'explorer.paso1.ayuda':
    'Ve a la página 2 en el sitio y copia esa dirección: así se ve cómo numera las páginas.',
  'explorer.url.label': '¿Qué página quieres recorrer?',
  'explorer.url.hint':
    'Pega la dirección tal cual. Si escribes {q} donde iría la palabra buscada y {page} donde va el número de página, el sitio se guarda una vez y solo cambias la palabra.',
  'explorer.url.placeholder': 'https://ejemplo.com/galeria?q=gatos',
  'explorer.termino.label': '¿Buscas una palabra concreta? (opcional)',
  'explorer.termino.hint':
    'Se coloca donde la dirección tenga {q}. Si la dirección no lleva {q}, este campo no hace nada.',
  'explorer.termino.placeholder': 'gatos',

  /* ── Explorador: paso 2 ────────────────────────────────────────── */
  'explorer.paso2.titulo': '¿Qué quieres obtener?',
  'explorer.paso2.ayuda':
    'Los enlaces se recogen siempre. Los archivos obligan a entrar en cada enlace, y eso tarda.',
  'explorer.objetivo.enlaces': 'Solo la lista de enlaces',
  'explorer.objetivo.enlaces.hint':
    'Recorre las páginas y te da las direcciones que encuentre. Es lo más rápido.',
  'explorer.objetivo.ficheros': 'Los archivos de dentro',
  'explorer.objetivo.ficheros.hint':
    'Además entra en cada enlace y busca los archivos que haya dentro. Tarda bastante más.',
  'explorer.tipoArchivo': '¿Qué tipo de archivo?',
  'explorer.preset.video': 'Vídeo',
  'explorer.preset.audio': 'Audio',
  'explorer.preset.imagen': 'Imágenes',
  'explorer.preset.otro': '+ Otro',
  'explorer.preset.otro.title': 'Escribir las extensiones a mano',
  'explorer.extensiones.label': 'Extensiones a buscar, separadas por comas',
  'explorer.extensiones.hint': 'Con el punto delante. Por ejemplo: .pdf, .zip',

  /* ── Explorador: paso 3 ────────────────────────────────────────── */
  'explorer.paso3.titulo': 'Todo listo',
  'explorer.explorar': 'Empezar a explorar',
  'explorer.explorando': 'Explorando…',
  'explorer.detectar': 'Que lo configure por mí',
  'explorer.detectar.title':
    'Abre la dirección, la analiza y rellena el formulario. Siempre es una sugerencia: revísala.',
  'explorer.analizando': 'Analizando…',
  'explorer.limpiar': 'Limpiar',

  /* ── Explorador: ajustes avanzados ─────────────────────────────── */
  'explorer.avanzados': 'Ajustes avanzados (opcional)',
  'explorer.modo.pregunta': '¿Cómo pasa de página el sitio?',
  'explorer.modo.auto': 'Detectar automáticamente (recomendado)',
  'explorer.modo.auto.hint':
    'Sirve para casi todos los sitios: usa lo que ya venga en la dirección.',
  'explorer.modo.manual': 'Indicar los patrones a mano',
  'explorer.modo.manual.hint':
    'Para decir exactamente qué enlaces seguir y cómo numera las páginas el sitio.',
  'explorer.modo.scroll': 'Scroll infinito',
  'explorer.modo.scroll.hint':
    'Para sitios sin botonera de páginas, que cargan más resultados al bajar. Aquí «hasta» cuenta cargas, no páginas.',
  'explorer.modo.resumen':
    'Sigues usando {que}. Pulsa «Indicar los patrones a mano» para verlos o cambiarlos.',
  'explorer.modo.resumen.enlaces': 'enlaces «{valor}»',
  'explorer.modo.resumen.parametro': 'parámetro «{valor}»',
  'explorer.modo.resumen.y': ' y ',
  'explorer.patron.label': '¿Qué enlaces seguir? (patrón de enlace)',
  'explorer.patron.hint':
    'Vacío = todos. «/videos/» se queda con los que lo contengan. Entre barras y con algún símbolo es una expresión regular: /\\/videos\\/\\d+/ solo coge las fichas numeradas.',
  'explorer.parametro.label': '¿Cómo numera las páginas? (nombre del parámetro)',
  'explorer.parametro.hint':
    'Solo el nombre, por ejemplo «page». Si el número va dentro de la dirección, no rellenes esto: escribe {page} en la dirección de partida.',
  'explorer.desde.label': 'Desde la página',
  'explorer.hasta.label': '¿Hasta qué página?',
  'explorer.hasta.hint': 'Como mucho {max} páginas de una vez.',
  'explorer.rapidez.label': '¿Con qué rapidez? (páginas a la vez)',
  'explorer.rapidez.hint':
    'Entre 1 y {max}. Cuanto más alto, antes acaba y más carga el sitio. Por defecto {defecto}.',
  'explorer.navegador.label': 'Abrir con navegador',
  'explorer.navegador.hint':
    'Abre cada página como lo haría un navegador de verdad, ejecutando su JavaScript. Hace falta si el sitio no enseña nada sin él. Mucho más lento: cuenta varios segundos por enlace.',
  'explorer.peso.label': 'Averiguar cuánto pesa cada archivo',
  'explorer.peso.hint':
    'Pregunta el peso de cada archivo sin descargarlo. Permite ordenar por tamaño y distinguir un vídeo entero de un clip de vista previa. Va más lento.',
  'explorer.licencia.label': 'Solo material con licencia abierta',
  'explorer.licencia.hint':
    'Se queda únicamente con las páginas que declaran una licencia abierta (Creative Commons, dominio público, CC0…). Lo que no declara licencia se descarta: por defecto una obra nace con todos los derechos reservados, así que la ausencia de licencia no significa que sea libre.',

  /* ── Explorador: ejemplos de paginación ────────────────────────── */
  'ejemplos.titulo': 'Pasa a la página 2 en el sitio y mira qué cambia en su dirección:',
  'ejemplos.campo.parametro': 'Nombre del parámetro',
  'ejemplos.campo.url': 'Dirección de partida',

  /* ── Explorador: estadísticas ──────────────────────────────────── */
  'stats.enlaces': 'Enlaces',
  'stats.paginas': 'Páginas recorridas',
  'stats.ficheros': 'Ficheros',
  'stats.duracion': 'Duración',
  'stats.fallidas': 'Páginas fallidas',

  /* ── Explorador: propuesta de configuración ────────────────────── */
  'propuesta.titulo': 'Esto es lo que propongo',
  'propuesta.hint':
    'Es una sugerencia, no una verdad: revísala y corrige lo que no encaje. Se han analizado {conNavegador} enlaces con navegador y {sinNavegador} sin él.',
  'propuesta.campo.patron': '¿Qué enlaces seguir?',
  'propuesta.campo.paginacion': 'Cómo pasa de página',
  'propuesta.campo.navegador': 'Abrir con navegador',
  'propuesta.campo.extensiones': 'Qué obtener',
  'propuesta.campo.alternativo': 'Patrón alternativo',
  'propuesta.alternativo.motivo':
    'Más amplio que el propuesto. Úsalo si el sugerido deja fuera resultados que sí querías.',
  'propuesta.vacio': '(vacío)',
  'propuesta.si': 'sí',
  'propuesta.no': 'no',
  'propuesta.parametro': 'parámetro «{valor}»',
  'propuesta.confianza': 'confianza {nivel}',
  'propuesta.aviso': 'A tener en cuenta',
  'propuesta.lista': 'Propuesta lista: revísala antes de explorar',
  'propuesta.fallo': 'No se pudo analizar la página',

  /* ── Explorador: validación y alertas ──────────────────────────── */
  'error.faltaUrl': 'Falta la dirección',
  'error.faltaUrl.detectar': 'Escribe en el paso 1 la dirección de la página que quieres analizar.',
  'error.faltaUrl.explorar': 'En el paso 1, escribe la página desde la que quieres empezar.',
  'error.urlInvalida': 'Dirección no válida',
  'error.urlInvalida.body': 'La dirección debe empezar por http:// o https://',
  'error.faltaTermino': 'Falta la palabra a buscar',
  'error.faltaTermino.body':
    'La dirección de partida lleva {q}, así que hay que indicar qué buscar en «¿Buscas una palabra concreta?».',
  'error.faltaParametro': 'Falta decir cómo numera las páginas',
  'error.faltaParametro.body':
    'Has pedido de la {desde} a la {hasta}, pero sin saber cómo pasa de página el sitio solo se descargará una. Abre «Ajustes avanzados», elige «Indicar los patrones a mano» y escribe el nombre del parámetro (por ejemplo «page»), o pon {page} en la dirección de partida.',
  'error.rangoInvalido': 'Rango de páginas inválido',
  'error.rangoInvalido.body': 'La página final no puede ser menor que la inicial.',
  'error.rangoGrande': 'Rango de páginas demasiado grande',
  'error.rangoGrande.body':
    'Has pedido {pedidas} páginas y el máximo por búsqueda es {max}. Reduce «¿Hasta qué página?» a {sugerido} o menos.',
  'error.busquedaFallo': 'La búsqueda falló',

  'aviso.scrollCortado': 'El scroll se detuvo antes de agotar el listado',
  'aviso.scrollCortado.body':
    'Tras {cargas} cargas, {motivo}. Es muy probable que el sitio tuviera más resultados: los que ves están incompletos. Sube «¿Hasta qué página?» para pedir más cargas, o afina el patrón de enlace para traer menos por carga.',
  'aviso.tope.rondas': 'se alcanzó el número máximo de cargas',
  'aviso.tope.elementos': 'se alcanzó el tope de elementos',
  'aviso.tope.tiempo': 'se agotó el tiempo máximo de scroll',
  'aviso.tope.navegador': 'el navegador dejó de responder',

  'aviso.soloEnlaces': 'Solo se han recogido enlaces, no archivos',
  'aviso.soloEnlaces.body':
    'En el paso 2 está elegido «Solo la lista de enlaces», así que no se ha entrado en cada enlace. Elige «Los archivos de dentro», marca el tipo que buscas y vuelve a explorar.',

  'aviso.sinVerificar': '{n} fichero(s) sin verificar',
  'aviso.sinVerificar.body':
    'No se pudo comprobar que pertenezcan a su página: pueden ser anuncios o vistas previas. Van marcados y SIN duración, porque la de la ficha es de otro vídeo. Compruébalos antes de descargarlos.',
  'aviso.descartados': '{n} fichero(s) descartados por no ser de su página',
  'aviso.descartados.body':
    'Eran anuncios o vistas previas de los vídeos relacionados. Los que ves sí comparten identificador con la ficha de la que salen.',

  'aviso.truncado': 'Resultados truncados',
  'aviso.truncado.body':
    'Se alcanzó el tope de la aplicación ({enlaces} enlaces / {ficheros} ficheros). Acota el patrón de enlace o el rango de páginas para obtener menos resultados.',

  'aviso.licencia': '{n} páginas descartadas por licencia',
  'aviso.licencia.body':
    'No declaraban una licencia abierta, así que se han omitido. Recuerda que la ausencia de licencia significa «todos los derechos reservados», no «libre».',

  'aviso.tiempoAgotado': 'Se agotó el tiempo máximo',
  'aviso.tiempoAgotado.body':
    'El recorrido superó los {minutos} minutos y se detuvo, así que los resultados están incompletos. Con «Abrir con navegador» cada enlace tarda varios segundos: reduce el rango de páginas o afina el patrón de enlace para revisar menos enlaces.',

  'aviso.sinFicheros': 'Se encontraron enlaces pero ningún archivo',
  'aviso.sinFicheros.conNavegador':
    'Se revisaron {n} páginas con navegador sin encontrar archivos de ese tipo. Puede que los enlaces no sean páginas de detalle (por ejemplo, redirecciones a otros sitios) o que el archivo se pida por una API que no deja rastro en el HTML.',
  'aviso.sinFicheros.sinNavegador':
    'Se revisaron {n} páginas sin encontrar archivos de ese tipo. Prueba a activar «Abrir con navegador» en los ajustes avanzados: ahora también se aplica al entrar en cada enlace.',

  /* ── Vista de vídeos ───────────────────────────────────────────── */
  'video.titulo': 'Sacar los vídeos de una página',
  'video.subtitulo':
    'Pega una dirección y te dice qué vídeos hay en ella y por dónde los ha encontrado.',
  'video.url.label': '¿De qué página quieres sacar los vídeos?',
  'video.url.hint':
    'Se mira una sola página, y se mira por cuatro vías: lo que se ve tras cargarla, lo que pide por la red, los reproductores incrustados y las direcciones escondidas en su código.',
  'video.url.placeholder': 'https://ejemplo.com/video/12345',
  'video.navegador.label': 'Abrir con navegador',
  'video.navegador.hint':
    'Abre la página como lo haría un navegador de verdad y mira qué pide. Encuentra vídeos que no están escritos en la página.',
  'video.peso.label': 'Averiguar cuánto pesa cada archivo',
  'video.peso.hint': 'Pregunta el peso de cada vídeo sin descargarlo. Va más lento.',
  'video.analizar': 'Analizar',
  'video.analizando': 'Analizando…',
  'video.stats.videos': 'Vídeos',
  'video.stats.formatos': 'Formatos',
  'video.stats.vias': 'Vías con resultados',
  'video.sinNavegador': 'El navegador no se pudo usar',
  'video.sinNavegador.body':
    'Se analizó solo el HTML. Los vídeos cargados por JavaScript pueden no aparecer.',
  'video.vacio.titulo': 'Todavía no hay vídeos',
  'video.vacio.texto': 'Pega la dirección de una página y pulsa «Analizar».',
  'video.sinResultados.titulo': 'No se encontraron vídeos',
  'video.sinResultados.texto':
    'Prueba a activar «Abrir con navegador»: muchos sitios no muestran el reproductor hasta que la página se abre de verdad.',
  'video.detectadoPor': 'Detectado por: {via}',
  'video.desconocido': 'desconocido',
  'video.todos': 'Todos ({n})',
  'video.abrir': 'Abrir',
  'video.descargar': 'Descargar .txt',
  'video.descargadas': '{n} URLs descargadas',
  'video.fallo': 'No se pudo analizar la página',
};
