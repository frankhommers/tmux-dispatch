# The service needs no tmux and mounts nothing from a host: an MCP server
# dials in over a WebSocket and carries everything tmux-shaped with it.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine
LABEL org.opencontainers.image.title="tmux-dispatch" \
      org.opencontainers.image.description="Human-approved tmux pane access for tmux-mcp agents" \
      org.opencontainers.image.source="https://github.com/frankhommers/tmux-dispatch" \
      org.opencontainers.image.url="https://github.com/frankhommers/tmux-dispatch" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
COPY LICENSE ./LICENSE
# SQLite lives here; mount a volume to keep the pool across restarts.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 7676
ENV PORT=7676 DATABASE_PATH=/data/tmux-mcp.db
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/api/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "server-dist/main.js"]
