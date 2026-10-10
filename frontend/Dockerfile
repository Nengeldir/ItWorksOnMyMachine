FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# Log each download: the classic builder (no buildx) shows nothing until a step ends
RUN npm ci --no-audit --no-fund --loglevel=http

COPY . .
RUN npm run build

FROM caddy:2.11-alpine AS runner

COPY --from=builder /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
