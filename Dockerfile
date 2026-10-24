# Tafac (formerly l'ent) production image: the frontend (one build for every university)
# plus the Express server, serving every university (MULTI_UNIVERSITY=1, as on tafac.fr).
# A self-hosted instance for one university sets MULTI_UNIVERSITY=0 and UNIVERSITY.
# See docs/SELF_HOSTING.md.

# --- Build: install everything, build the frontend ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Commit shown in "À propos" (the build context has no .git).
ARG BUILD_HASH
RUN npm run build

# --- Runtime: production dependencies, sources and built frontend ---
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    MULTI_UNIVERSITY=1 \
    PORT=3000 \
    DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The server imports a few modules from src/ (demo account), so the sources
# stay; only the built frontend comes from the build stage.
COPY . .
COPY --from=build /app/dist ./dist
# Automatic app icons (server/appIcons.js) are remembered here: mount a
# volume on it (deploy/docker-compose.yml does). Owned by `node` so a fresh
# named volume starts out writable too.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/robots.txt" || exit 1
CMD ["node", "server.js"]
