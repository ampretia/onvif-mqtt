# SPDX-License-Identifier: Apache-2.0

ARG VARIANT="slim"
FROM node:24-${VARIANT} AS builder

WORKDIR /usr/src/app

# Ensure package files are copied first for optimal caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

FROM node:24-${VARIANT} AS production

WORKDIR /usr/src/app

# Copy built artifacts and production dependencies
COPY --chown=node:node --from=builder /usr/src/app/lib ./lib
COPY --chown=node:node --from=builder /usr/src/app/package.json ./
COPY --chown=node:node --from=builder /usr/src/app/package-lock.json ./

# Use modern npm flag instead of deprecated --only=production
RUN npm ci --omit=dev

USER node
ENV NODE_ENV=production
WORKDIR /config

# Optional: Add a healthcheck for homelab dashboards/monitoring
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT [ "node", "--enable-source-maps", "/usr/src/app/lib/main.js" ]