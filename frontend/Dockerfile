# Built from the repo root (docker-compose.yml) so it can copy shared/ as well
FROM node:24-alpine AS builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
# Log each download: the classic builder (no buildx) shows nothing until a step ends
RUN npm ci --no-audit --no-fund --loglevel=http

# The shared catalog (items, recipes, skills...), imported from ../shared/catalog like in the repo
COPY shared/ /app/shared/
COPY frontend/ .
RUN npm run build

FROM caddy:2.11-alpine AS runner

COPY --from=builder /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
