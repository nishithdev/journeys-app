# Journeys: serves the app and saves to Google Sheets with a service-account JSON key.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/service-account.json

WORKDIR /app
COPY server/server.js ./server.js
COPY app/ ./public/

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
