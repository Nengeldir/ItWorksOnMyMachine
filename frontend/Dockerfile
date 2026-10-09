FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM caddy:2.11-alpine AS runner

COPY --from=builder /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
