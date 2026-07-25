'use strict';

const path = require('node:path');

require('dotenv').config();

/**
 * Configuración central de URL Explorer.
 *
 * Todas las constantes que antes estaban esparcidas por server.js como números
 * mágicos viven aquí y son sobreescribibles por variable de entorno.
 */

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function listFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * `trust proxy` admite varios tipos y la diferencia importa: 'true' (cadena)
 * y true (booleano) significan "confía en cualquiera", que es justo lo que no
 * queremos por defecto. Un número es "confía en N saltos"; el resto se pasa
 * tal cual a Express.
 */
function trustProxyFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const limpio = raw.trim();
  if (limpio.toLowerCase() === 'false') return false;
  if (limpio.toLowerCase() === 'true') return true;

  const saltos = Number.parseInt(limpio, 10);
  if (String(saltos) === limpio && Number.isFinite(saltos)) return saltos;

  return limpio;
}

const config = {
  // No asumir 3000: esta máquina corre en 3001 vía .env
  port: intFromEnv('PORT', 3000),
  env: process.env.NODE_ENV || 'development',

  http: {
    // Timeout de descarga de una página en fase 1
    pageTimeoutMs: intFromEnv('HTTP_PAGE_TIMEOUT_MS', 8000),
    // Timeout de descarga en fase 2 (búsqueda de ficheros)
    fileScanTimeoutMs: intFromEnv('HTTP_FILE_SCAN_TIMEOUT_MS', 8000),
    // Timeout del HEAD para obtener el tamaño de un fichero
    headTimeoutMs: intFromEnv('HTTP_HEAD_TIMEOUT_MS', 5000),
    maxRedirects: intFromEnv('HTTP_MAX_REDIRECTS', 5),
    // Tope de bytes por respuesta: evita que una sola página agote la RAM
    maxResponseBytes: intFromEnv('HTTP_MAX_RESPONSE_BYTES', 10 * 1024 * 1024),
    retries: intFromEnv('HTTP_RETRIES', 3),
    retryBaseDelayMs: intFromEnv('HTTP_RETRY_BASE_DELAY_MS', 1000),
    /**
     * Espera propia para el 429, porque no es un fallo pasajero.
     *
     * El backoff lineal genérico (1s/2s/3s) reintenta DENTRO del bloqueo: el
     * sitio nos está frenando por volumen y la recuperación real medida es de
     * unos dos minutos, así que cada reintento rápido solo suma al contador
     * que provocó el bloqueo.
     */
    retry429BaseDelayMs: intFromEnv('HTTP_RETRY_429_BASE_DELAY_MS', 5000),
    // Tope de la espera de un 429, incluido lo que pida `Retry-After`: una
    // cabecera de una hora dejaría el crawl colgado sin decir nada.
    retry429MaxDelayMs: intFromEnv('HTTP_RETRY_429_MAX_DELAY_MS', 30000),
  },

  crawl: {
    // Límites duros: el cliente puede pedir menos, nunca más
    maxPages: intFromEnv('CRAWL_MAX_PAGES', 50),
    // Direcciones que se pueden explorar en un mismo lote (multi-URL). Cada
    // una es un crawl completo con su fase 1 y su fase 2, así que el tope
    // acota el trabajo total que una sola petición puede desencadenar.
    maxUrls: intFromEnv('CRAWL_MAX_URLS', 10),
    maxLinks: intFromEnv('CRAWL_MAX_LINKS', 5000),
    maxFiles: intFromEnv('CRAWL_MAX_FILES', 5000),
    defaultConcurrency: intFromEnv('CRAWL_DEFAULT_CONCURRENCY', 4),
    maxConcurrency: intFromEnv('CRAWL_MAX_CONCURRENCY', 12),
    // Pausa entre páginas de la paginación (fase 1)
    pageDelayMs: intFromEnv('CRAWL_PAGE_DELAY_MS', 500),
    // Duración máxima total de un crawl antes de abortar
    maxDurationMs: intFromEnv('CRAWL_MAX_DURATION_MS', 10 * 60 * 1000),
  },

  throttle: {
    // Espacio mínimo entre dos peticiones al MISMO dominio
    minIntervalMs: intFromEnv('THROTTLE_MIN_INTERVAL_MS', 250),
    // Peticiones simultáneas máximas contra un mismo dominio
    maxConcurrentPerHost: intFromEnv('THROTTLE_MAX_CONCURRENT_PER_HOST', 4),
    /**
     * Freno reactivo por host (circuit breaker).
     *
     * El intervalo mínimo es fijo y no sabe nada de cómo está respondiendo el
     * sitio: si empieza a devolver 429 se le sigue pidiendo al mismo ritmo.
     * Estas cuatro constantes son lo que convierte esa señal en menos ritmo
     * contra ESE host, sin tocar a los demás.
     */
    // 429 consecutivos que se toleran antes de penalizar al host
    circuitBreakerThreshold: intFromEnv('THROTTLE_CIRCUIT_BREAKER_THRESHOLD', 5),
    // Cuánto se multiplica el intervalo mínimo mientras dura la penalización
    circuitBreakerFactor: intFromEnv('THROTTLE_CIRCUIT_BREAKER_FACTOR', 8),
    // Tope del intervalo penalizado: separar más no ayuda y alarga el crawl
    circuitBreakerMaxMs: intFromEnv('THROTTLE_CIRCUIT_BREAKER_MAX_MS', 5000),
    // Cuánto dura la penalización. Dos minutos es la recuperación real medida
    // sobre un sitio que bloquea por volumen, no un número redondo.
    circuitBreakerCooldownMs: intFromEnv('THROTTLE_CIRCUIT_BREAKER_COOLDOWN_MS', 120000),
  },

  browser: {
    enabled: boolFromEnv('BROWSER_ENABLED', true),
    // Ruta a un Chromium del sistema. En Docker se usa el de apt y se evita
    // que Puppeteer descargue el suyo (~300 MB y suele desincronizarse con
    // las librerías de la imagen). Vacío = el Chromium que trae Puppeteer.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // Directorio de perfil de Chromium. Debe ser escribible aunque el resto
    // del sistema de ficheros esté en solo lectura.
    userDataDir: process.env.BROWSER_USER_DATA_DIR || '/tmp/chromium-data',
    // Tamaño del pool: se reutilizan páginas en vez de lanzar un Chromium
    // por cada URL, que era el mayor coste de la versión anterior.
    poolSize: intFromEnv('BROWSER_POOL_SIZE', 2),
    navigationTimeoutMs: intFromEnv('BROWSER_NAVIGATION_TIMEOUT_MS', 30000),
    // Tope para CUALQUIER orden del protocolo DevTools. Sin esto, un
    // page.evaluate que no vuelve (páginas con scripts que bloquean el hilo)
    // deja la pestaña colgada indefinidamente y agota el pool.
    protocolTimeoutMs: intFromEnv('BROWSER_PROTOCOL_TIMEOUT_MS', 45000),
    // Tope propio del scroll: es la operación que más se cuelga.
    scrollTimeoutMs: intFromEnv('BROWSER_SCROLL_TIMEOUT_MS', 10000),
    // 'networkidle2' espera a que la red se calme, y en páginas con anuncios
    // y trackers eso no pasa nunca: agotaban el timeout entero una por una.
    // Con 'domcontentloaded' + el scroll y la espera posteriores ya tenemos
    // el DOM que necesitamos, y cada página tarda segundos en vez de 30.
    waitUntil: process.env.BROWSER_WAIT_UNTIL || 'domcontentloaded',
    // Espera tras el scroll para que cargue el contenido diferido
    settleMs: intFromEnv('BROWSER_SETTLE_MS', 2500),
    scrollStepPx: intFromEnv('BROWSER_SCROLL_STEP_PX', 500),
    maxScrollPx: intFromEnv('BROWSER_MAX_SCROLL_PX', 10000),
    // Se cierra el navegador tras este tiempo sin uso
    idleShutdownMs: intFromEnv('BROWSER_IDLE_SHUTDOWN_MS', 60000),
  },

  /**
   * Scroll infinito (modo de paginación "scroll").
   *
   * Todos estos son TOPES DUROS, no sugerencias. Una sola exploración de este
   * tipo ocupa una pestaña del pool durante toda la fase 1, y el pool tiene
   * dos: un sitio con scroll sin fin bloquearía la aplicación entera para
   * todo el mundo. Cada tope corta por un motivo distinto y hacen falta los
   * tres, porque un sitio puede ser lento sin cargar nada, rápido cargando
   * sin parar, o quedarse a medias.
   */
  scroll: {
    // Cargas máximas por exploración
    maxRounds: intFromEnv('SCROLL_MAX_ROUNDS', 50),
    // Tiempo máximo de la fase de scroll, pase lo que pase
    maxDurationMs: intFromEnv('SCROLL_MAX_DURATION_MS', 120000),
    // Enlaces acumulados a partir de los cuales se para
    maxElements: intFromEnv('SCROLL_MAX_ELEMENTS', 3000),
    // Espera tras cada scroll para que cargue el lote siguiente
    settleMs: intFromEnv('SCROLL_SETTLE_MS', 1200),
    // Rondas seguidas sin enlaces nuevos que se consideran "ya no hay más".
    // Con 1 sola se cortaría en el primer lote que tarde un poco de más.
    stableRounds: intFromEnv('SCROLL_STABLE_ROUNDS', 3),
  },

  security: {
    // Protección SSRF. Desactivar SOLO en tests contra fixtures locales.
    blockPrivateAddresses: boolFromEnv('SECURITY_BLOCK_PRIVATE_ADDRESSES', true),
    allowedProtocols: listFromEnv('SECURITY_ALLOWED_PROTOCOLS', ['http:', 'https:']),
    // Allowlist opcional de hosts. Vacía = cualquier host público.
    allowedHosts: listFromEnv('SECURITY_ALLOWED_HOSTS', []),
    maxUrlLength: intFromEnv('SECURITY_MAX_URL_LENGTH', 2048),
    /**
     * En quién se confía para leer `X-Forwarded-For`.
     *
     * Estaba en `true`, que significa "confía en CUALQUIERA". Como `req.ip`
     * sale de esa cabecera y el rate limiting va por `req.ip`, cualquier
     * cliente podía mandar una X-Forwarded-For distinta en cada petición y
     * saltarse el límite por completo — incluido el de 5 intentos por minuto
     * del desbloqueo de admin, que es lo único que frena la fuerza bruta
     * contra ADMIN_TOKEN. Medido: 0 bloqueos en 40 peticiones rotando la
     * cabecera, frente a 10 de 40 con la misma IP.
     *
     * Por defecto `false`: no se cree la cabecera a nadie.
     *
     * Se probó 'loopback' y NO sirve aquí: significa "confía si quien conecta
     * es loopback", y en este despliegue los clientes conectan justamente
     * desde localhost (Docker publica el 3001 en la propia máquina), así que
     * seguían pudiendo falsificarla. El test de regresión lo cazó.
     *
     * Detrás de un proxy inverso real, poner aquí SU dirección; nunca 'true'.
     * Acepta lo mismo que Express: 'loopback', 'uniquelocal', una lista de
     * IPs/CIDR, un número de saltos, o false.
     */
    trustProxy: trustProxyFromEnv('TRUST_PROXY', false),
    rateLimit: {
      windowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 60 * 1000),
      maxRequests: intFromEnv('RATE_LIMIT_MAX_REQUESTS', 30),
    },
  },

  admin: {
    // Token que desbloquea los perfiles guardados. Vacío ⇒ modo admin
    // deshabilitado: la aplicación funciona igual pero sin perfiles para
    // nadie, y los endpoints de admin responden 404 en vez de 401 (no tiene
    // sentido anunciar una puerta que no existe).
    token: process.env.ADMIN_TOKEN || '',
    // Fichero de perfiles, FUERA del control de versiones. Es lo que mantiene
    // los nombres de los sitios fuera del repositorio.
    profilesPath:
      process.env.ADMIN_PROFILES_PATH || path.join(__dirname, '..', '..', 'data', 'profiles.json'),
    // Rate limiting propio, mucho más estricto que el general: es el único
    // endpoint donde tiene sentido intentar fuerza bruta.
    unlockRateLimit: {
      windowMs: intFromEnv('ADMIN_UNLOCK_WINDOW_MS', 60 * 1000),
      maxRequests: intFromEnv('ADMIN_UNLOCK_MAX_ATTEMPTS', 5),
    },
    // Tope de perfiles y de tamaño del fichero guardado: el body ya está
    // limitado a 64kb, esto acota además lo que se acepta persistir.
    maxProfiles: intFromEnv('ADMIN_MAX_PROFILES', 100),
  },

  /**
   * Miniaturas. Las sirve el BACKEND, nunca el navegador del usuario: ver
   * services/thumbnails.js para el porqué (privacidad y CSP).
   */
  thumbnails: {
    // Desactivadas por defecto: son peticiones extra a los sitios explorados
    enabled: boolFromEnv('THUMBNAILS_ENABLED', true),
    timeoutMs: intFromEnv('THUMBNAILS_TIMEOUT_MS', 6000),
    // Tope por imagen: una miniatura legítima no llega ni de lejos
    maxBytes: intFromEnv('THUMBNAILS_MAX_BYTES', 2 * 1024 * 1024),
    // Caché EN MEMORIA: muere con el proceso y no deja rastro en disco
    cacheMaxEntries: intFromEnv('THUMBNAILS_CACHE_MAX_ENTRIES', 300),
    cacheMaxBytes: intFromEnv('THUMBNAILS_CACHE_MAX_BYTES', 64 * 1024 * 1024),
    // Cuánto puede cachear el navegador lo que ya servimos nosotros
    browserCacheSeconds: intFromEnv('THUMBNAILS_BROWSER_CACHE_SECONDS', 3600),
    /**
     * Límite PROPIO, mucho más alto que el general.
     *
     * El de /api son 30 peticiones por minuto, pensado para operaciones
     * caras: un crawl, un análisis de vídeo. Una miniatura no es eso —es una
     * imagen pequeña y cacheada— y una sola lista de resultados necesita
     * decenas. Compartiendo el límite general, las primeras 30 cargaban y el
     * resto salía con el icono de imagen rota. Reproducido: de 50 peticiones
     * seguidas, 30 con 200 y 20 con 429.
     */
    rateLimit: {
      windowMs: intFromEnv('THUMBNAILS_RATE_WINDOW_MS', 60 * 1000),
      maxRequests: intFromEnv('THUMBNAILS_RATE_MAX', 600),
    },
  },

  /**
   * Exploraciones frenadas a medias, para poder continuarlas.
   *
   * EN MEMORIA: si el proceso se reinicia, lo pendiente se pierde. Es el
   * precio de no persistir y está elegido; ver services/jobs.js.
   */
  jobs: {
    // Cuánto se guarda un trabajo frenado antes de tirarlo
    ttlMs: intFromEnv('JOBS_TTL_MS', 30 * 60 * 1000),
    // Tope de trabajos vivos: al llenarse se tira el más viejo
    maxJobs: intFromEnv('JOBS_MAX', 20),
  },

  video: {
    /**
     * Peticiones de peso simultáneas.
     *
     * Sustituye a la pausa fija que había entre HEADs: la cortesía por
     * dominio ya la garantiza HostThrottle (intervalo mínimo y máximo
     * simultáneas por hostname), así que esperar además entre vídeos de CDN
     * distintos solo hacía la petición más lenta sin proteger a nadie.
     */
    metadataConcurrency: intFromEnv('VIDEO_METADATA_CONCURRENCY', 4),
    maxMetadataLookups: intFromEnv('VIDEO_MAX_METADATA_LOOKUPS', 100),
    maxResults: intFromEnv('VIDEO_MAX_RESULTS', 500),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
