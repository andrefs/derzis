# syntax=docker/dockerfile:1

FROM node:22 AS build


ENV NODE_ENV=production
WORKDIR /home/node/derzis/

COPY --chown=node:node ["common/src", "./common/src"]
COPY --chown=node:node ["common/package.json", "common/package-lock.json", "common/tsconfig.json", "./common/"]

COPY --chown=node:node ["validator/src", "./validator/src"]
COPY --chown=node:node ["validator/data", "./validator/data"]
COPY --chown=node:node ["validator/package.json", "validator/package-lock.json", "validator/tsconfig.json", "./validator/"]



WORKDIR /home/node/derzis/common
RUN npm install --include=dev

WORKDIR /home/node/derzis/validator
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

WORKDIR /usr/src/derzis/validator/

COPY --from=build --chown=node:node /home/node/derzis/validator/node_modules ./node_modules/
COPY --from=build --chown=node:node /home/node/derzis/validator/tsconfig.json ./
COPY --from=build --chown=node:node /home/node/derzis/validator/package.json ./
COPY --from=build --chown=node:node /home/node/derzis/validator/src ./src/
COPY --from=build --chown=node:node /home/node/derzis/validator/data ./data/

WORKDIR /usr/src/derzis/validator

USER 1000
ENTRYPOINT ["src/bin/validator"]
