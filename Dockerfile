# The service needs no tmux and mounts nothing from a host: an MCP server
# dials in over a WebSocket and carries everything tmux-shaped with it.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
# SQLite lives here; mount a volume to keep the pool across restarts.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 7676
ENV PORT=7676 DATABASE_PATH=/data/tmux-mcp.db
CMD ["node", "server-dist/main.js"]
