#
# SPDX-License-Identifier: Apache-2.0
#

ARG VARIANT="slim"

FROM node:24-${VARIANT} AS builder

WORKDIR /usr/src/app

# Copy node.js source and build, changing owner as well
COPY --chown=node:node . /usr/src/app
RUN npm ci && npm run build && npm shrinkwrap


FROM node:24-${VARIANT} AS production


WORKDIR /usr/src/app
COPY --chown=node:node --from=builder /usr/src/app/lib ./lib
COPY --chown=node:node --from=builder /usr/src/app/package.json ./
COPY --chown=node:node --from=builder /usr/src/app/npm-shrinkwrap.json ./

RUN npm ci --only=production


USER node
ENV NODE_ENV=production
WORKDIR /config
ENTRYPOINT [ "node","/usr/src/app/lib/main.js" ]

