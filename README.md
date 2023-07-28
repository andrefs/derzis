# derzis [![Node.js CI](https://github.com/andrefs/derzis/actions/workflows/node.js.yml/badge.svg?branch=testing)](https://github.com/andrefs/derzis/actions/workflows/node.js.yml)

<img src="https://icons.getbootstrap.com/assets/icons/cloud-lightning.svg"  width="100" height="100">

A path-aware distributed linked data crawler.

## Run

The easiest way of deploying Derzis is using Docker, but it can also
be executed without using containers.

### Docker

#### Dependencies

- docker
- docker-compose

#### Running

- Edit `src/config/index.ts` to modify the crawler parameters.
- Run `docker-compose up --build`.
- The web app will be accessible at http://localhost:5432/processes

### Locally

#### Install dependencies

- MongoDB
- Redis
- Node.js v20
- Run `npm install` on the root folder

#### Run in development mode

- Open a terminal and run `npm run worker:dev`.
- Open another terminal and run `npm run manager:dev`.
- The web app will be accessible at http://localhost:5432/processes

#### Build and run

- Run `npm run build` on the root folder
- Make sure you have Redis and MongoDB running.
- Edit `dist/src/config/index.js` to modify the crawler parameters.
- Open a terminal and run `node ./dist/src/manager/bin/manager.js`.
- Open another terminal and run `./dist/src/worker/bin/worker-pool`.
- The web app will be accessible at http://localhost:5432/processes
