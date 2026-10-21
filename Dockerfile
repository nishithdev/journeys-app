# Journeys: serves the app and saves to Google Sheets with a service-account JSON key.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/service-account.json \
    DATA_DIR=/data

# Time zone data, so the time zone setting sets "today" and the nudge hour correctly.
# /data holds settings changed in the app (Settings → Server settings).
RUN apk add --no-cache tzdata \
 && mkdir -p /data && chown node:node /data

WORKDIR /app
COPY server/*.js ./
COPY app/ ./public/

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
