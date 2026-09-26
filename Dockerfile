# syntax=docker/dockerfile:1

# ── Stufe 1: Oberfläche bauen ────────────────────────────────
FROM node:22-bookworm-slim AS build
# Build-Werkzeuge, falls für better-sqlite3 keine vorkompilierte Version verfügbar ist
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Stufe 2: schlankes Laufzeit-Image ────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/sammlung.db \
    UPLOAD_DIR=/app/data/uploads
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts

RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
