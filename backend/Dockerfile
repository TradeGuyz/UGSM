# The API has no runtime dependencies and Node runs its TypeScript directly, so there's no build step
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3001 \
    SETTINGS_FILE=/data/settings.json

WORKDIR /app
COPY package.json ./
COPY src ./src

# Settings (PIN hash and RankUOG keys) live on a volume so they survive rebuilds
RUN mkdir /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "src/index.ts"]
