# derzis-crawler

A path-aware distributed linked data crawler.

## Run

The easiest way of deploying Derzis is using Docker, but it can also
be executed without using containers.

### Docker

#### Running

* Edit `data/seeds.txt` and add the IRIs for the seed resources.
* Edit `common/config.js`, `worker/config.js` or `manager/config.js`
  to modify the crawler parameters.
* Run `docker-compose up`.

### Locally

#### Dependencies

* MongoDB
* Redis
* Node.js v16
* All Node.js packages listed

#### Running

* Run `yarn install` in each of the folders `common`, `worker` and
  `manager`.
* Open a terminal and run `node manager/bin/manager.js`.
* Open another terminal and run `./worker/bin/worker-pool`.




