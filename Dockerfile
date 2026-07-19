# URL Explorer — imagen de producción
#
# Puppeteer necesita un Chromium. En vez de dejar que se descargue el suyo
# (~300 MB, y se desincroniza con las librerías del sistema base), se instala
# el de Debian y se le apunta con PUPPETEER_EXECUTABLE_PATH.

FROM node:22-bookworm-slim AS deps

ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

# Copiar solo los manifiestos: la capa de dependencias se cachea mientras
# package.json y el lockfile no cambien.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=3000

# Chromium y las fuentes mínimas para que renderice texto real.
# --no-install-recommends evita arrastrar medio escritorio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        fonts-noto-color-emoji \
        ca-certificates \
        dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

# El usuario `node` ya viene en la imagen base. Chromium no debe correr como
# root, y el proceso tampoco.
USER node

EXPOSE 3000

# Chromium deja procesos hijo; dumb-init hace de PID 1 y los recoge, además de
# reenviar SIGTERM para que el apagado ordenado de server.js se ejecute.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
