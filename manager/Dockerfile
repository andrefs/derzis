# syntax=docker/dockerfile:1


FROM node:22 AS build
# Build stage

ARG MANAGER_DATABASE='drz-mng-docker'
ARG MONGODB_HOST='localhost'
ARG MONGODB_PORT='27018'
ENV MANAGER_DATABASE=${MANAGER_DATABASE}
ENV MONGODB_HOST=${MONGODB_HOST}
ENV MONGODB_PORT=${MONGODB_PORT}


ENV NODE_ENV=production
WORKDIR /home/node/derzis/

COPY --chown=node:node ["common/src", "./common/src"]
COPY --chown=node:node ["common/package.json", "common/package-lock.json", "common/tsconfig.json", "./common/"]

COPY --chown=node:node ["config/src", "./config/src"]
COPY --chown=node:node ["config/package.json", "config/package-lock.json", "config/tsconfig.json", "./config/"]

COPY --chown=node:node ["models/src", "./models/src"]
COPY --chown=node:node ["models/package.json", "models/package-lock.json", "./models/package-lock.json", "models/tsconfig.json", "./models/"]

COPY --chown=node:node ["manager/src", "./manager/src"]
COPY --chown=node:node ["manager/.svelte-kit/",  "./manager/.svelte-kit/"]
COPY --chown=node:node ["manager/package.json", "manager/package-lock.json", "manager/tsconfig.json", "manager/vite.config.ts","manager/svelte.config.js", "./manager/"]


WORKDIR /home/node/derzis/common
RUN npm install --include=dev

WORKDIR /home/node/derzis/config
RUN npm install --include=dev

WORKDIR /home/node/derzis/models
RUN npm install --include=dev

WORKDIR /home/node/derzis/manager
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

WORKDIR /usr/src/derzis/manager/

COPY --from=build --chown=node:node /home/node/derzis/manager/node_modules ./node_modules/
COPY --from=build --chown=node:node /home/node/derzis/manager/vite.config.ts ./
COPY --from=build --chown=node:node /home/node/derzis/manager/.svelte-kit/ ./.svelte-kit/
COPY --from=build --chown=node:node /home/node/derzis/manager/package.json ./
COPY --from=build --chown=node:node /home/node/derzis/manager/src ./src/

WORKDIR /usr/src/derzis/manager

USER 1000
CMD ["npm", "run", "serve"]
