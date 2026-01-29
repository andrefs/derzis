# syntax=docker/dockerfile:1

FROM node:22 AS build
# Build stage

ARG WORKER_DATABASE='drz-wrk-docker'
ARG MONGODB_HOST='localhost'
ARG MONGODB_PORT='27018'
ARG REDIS_HOST='localhost'
ARG REDIS_PORT='6379'
ENV WORKER_DATABASE=${WORKER_DATABASE}
ENV MONGODB_HOST=${MONGODB_HOST}
ENV MONGODB_PORT=${MONGODB_PORT}
ENV REDIS_HOST=${REDIS_HOST}
ENV REDIS_PORT=${REDIS_PORT}




ENV NODE_ENV=production
WORKDIR /home/node/derzis/

COPY --chown=node:node ["common/src", "./common/src"]
COPY --chown=node:node ["common/package.json", "common/package-lock.json", "common/tsconfig.json", "./common/"]

COPY --chown=node:node ["config/src", "./config/src"]
COPY --chown=node:node ["config/package.json", "config/package-lock.json", "config/tsconfig.json", "./config/"]

COPY --chown=node:node ["models/src", "./models/src"]
COPY --chown=node:node ["models/package.json", "models/package-lock.json", "./models/package-lock.json", "models/tsconfig.json", "./models/"]

COPY --chown=node:node ["worker/src", "./worker/src"]
COPY --chown=node:node ["worker/package.json", "worker/package-lock.json", "worker/tsconfig.json", "./worker/"]


WORKDIR /home/node/derzis/common
RUN npm install --include=dev

WORKDIR /home/node/derzis/config
RUN npm install --include=dev

WORKDIR /home/node/derzis/models
RUN npm install --include=dev

WORKDIR /home/node/derzis/worker
RUN npm install --include=dev    

#npm ci --only=production

# Run stage

#FROM gcr.io/distroless/nodejs22-debian11
FROM node:22
ENV NODE_ENV=production
#FIXME
ENV NODE_OPTIONS=--max-old-space-size=6000

WORKDIR /usr/src/derzis/

COPY --from=build --chown=node:node /home/node/derzis/common ./common/
COPY --from=build --chown=node:node /home/node/derzis/config ./config/
COPY --from=build --chown=node:node /home/node/derzis/models ./models/

WORKDIR /usr/src/derzis/worker/

COPY --from=build --chown=node:node /home/node/derzis/worker/node_modules ./node_modules/
COPY --from=build --chown=node:node /home/node/derzis/worker/tsconfig.json ./
COPY --from=build --chown=node:node /home/node/derzis/worker/package.json ./
COPY --from=build --chown=node:node /home/node/derzis/worker/src ./src/

WORKDIR /usr/src/derzis/worker

USER 1000
CMD ["src/bin/worker"]
