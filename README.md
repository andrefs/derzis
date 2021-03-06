# derzis-crawler [![Node.js CI](https://github.com/andrefs/derzis/actions/workflows/node.js.yml/badge.svg?branch=testing)](https://github.com/andrefs/derzis/actions/workflows/node.js.yml)
<img src="https://icons.getbootstrap.com/assets/icons/cloud-lightning.svg"  width="100" height="100">



A path-aware distributed linked data crawler.

## Run

The easiest way of deploying Derzis is using Docker, but it can also
be executed without using containers.

### Docker

#### Dependencies

* docker
* docker-compose

#### Running

* Edit `data/seeds.txt` and add the IRIs for the seed resources.
* Edit `common/config.js`, `worker/config.js` or `manager/config.js`
  to modify the crawler parameters.
* Run `docker-compose up --build`.

### Locally

#### Dependencies

* MongoDB
* Redis
* Node.js v16
* Run `yarn install` in each of the folders `common`, `worker` and
  `manager`.

#### Running

* Open a terminal and run `node manager/bin/manager.js`.
* Open another terminal and run `./worker/bin/worker-pool`.




