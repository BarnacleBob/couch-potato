FROM node:26-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
# Claude is told the local time of day when it picks, so the container needs real timezones (set TZ in .env).
RUN apk add --no-cache tzdata

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.mjs ./
COPY public ./public
# Default station presets. Mount ./stations over this to edit them from the host.
COPY stations ./stations

# Personal data (history, lineups, subscriptions, caches). Mount a volume here to keep it.
RUN mkdir -p data && chown -R node:node /app
USER node
VOLUME ["/app/data"]

EXPOSE 8787
CMD ["node", "server.mjs"]
