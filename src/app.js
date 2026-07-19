'use strict';

const path = require('node:path');
const express = require('express');

const config = require('./config');
const apiRoutes = require('./routes');
const { createRateLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();

  // Necesario para que req.ip sea correcto tras un reverse proxy
  app.set('trust proxy', true);
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
