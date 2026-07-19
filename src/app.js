'use strict';

const path = require('node:path');
const express = require('express');

const config = require('./config');
const apiRoutes = require('./routes');
const thumbnailRoutes = require('./routes/thumbnail');
const { createRateLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();

  /**
   * De quién se acepta `X-Forwarded-For`.
   *
   * NO poner `true` aquí. `true` es "confía en cualquiera", y como `req.ip`
   * sale de esa cabecera y el rate limiting va por `req.ip`, un cliente que
   * rote la cabecera se salta el límite entero — incluida la protección de
   * fuerza bruta del desbloqueo de admin. Ver `security.trustProxy`.
   */
  app.set('trust proxy', config.security.trustProxy);
  app.disable('x-powered-by');

  // Tope de body: nada legítimo se acerca a esto
  app.use(express.json({ limit: '64kb' }));

  // Cabeceras de seguridad. La CSP es estricta porque el front no carga
  // recursos externos ni usa scripts inline.
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    next();
  });

  /**
   * Las miniaturas van con su PROPIO límite, y antes del general.
   *
   * El límite de /api son 30 peticiones por minuto porque está pensado para
   * lo caro: un crawl, un análisis de vídeo. Una miniatura es una imagen
   * pequeña que además se sirve de caché, y una sola lista de resultados
   * necesita decenas. Cuando compartían límite, las primeras 30 cargaban y
   * el resto aparecía como imagen rota.
   */
  app.use('/api', createRateLimiter(config.thumbnails.rateLimit), thumbnailRoutes);

  app.use('/api', createRateLimiter(), apiRoutes);

  // no-cache no significa "no guardes", sino "revalida siempre antes de
  // usar". Con max-age=0 los navegadores seguian sirviendo modulos ES desde
  // memoria hasta un recargado forzado, asi que tras desplegar se veia la
  // version anterior. Con esto basta con recargar normal.
  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ['html'],
      etag: true,
      lastModified: true,
      setHeaders: res => res.set('Cache-Control', 'no-cache'),
    })
  );

  // SPA: cualquier ruta no-API sirve el shell del front
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, config, PUBLIC_DIR };
