# Derzis

**Derzis** is an open-source, path-aware Linked Data crawler. Given a set of seed
resources (RDF IRIs), it traverses the Linked Data cloud by recursively
dereferencing the IRIs returned in RDF documents, following the semantic links
(extracted triples) found along the way.

Unlike generic Semantic Web crawlers, Derzis records the _paths_ it follows while
crawling. This makes it possible to constrain the crawling frontier using
**property-path restrictions** — limiting how many distinct properties a path may
contain, how deep it may go, which predicates to follow, and in which direction —
so that a potentially enormous graph is reduced to a manageable, relevant
sub-graph centred on the seed resources.

- Source: <https://github.com/andrefs/derzis>
- Paper: _Derzis: a path aware linked data crawler_, SLATE 2021 (OASIcs Vol. 94,
  Article 1). The codebase has since evolved well beyond the paper; this README
  describes the current implementation, which is the source of truth.

---

## Why a path-aware crawler?

Accessing the Semantic Web can be done in several ways: downloading large tripleset
dumps, querying SPARQL/Triple Pattern Fragments endpoints, custom RDF APIs, or
**dereferencing resource IRIs** (the _follow-your-nose_ / Linked Data interface).
The Linked Data interface is light for both clients and servers — no complex query
engine is needed and data is always up to date — but it does not support complex
queries on its own. Recursively following links is enough to gather information
about a set of resources, or to extract the relevant sub-graph that can then be
processed with other methods.

Derzis targets exactly this: it starts from seed IRIs and crawls outward, but keeps
track of each path so the traversal can be constrained. This is particularly useful
as a pre-processing step for graph-based semantic measures, which are often
impractical on full-scale knowledge graphs.

### Graph-reduction strategies

During a crawl, Derzis reduces the explored graph using the following rules:

- **Triples where the crawled resource is the _predicate_ are discarded.** Such
  triples describe the property itself (e.g. `ex:hasColor rdf:type rdf:Property`),
  not the resource being crawled.
- **Crawling follows only subject/object resources**, never predicate IRIs.
- **A path may contain at most a maximum number of distinct properties**
  (`maxPathProps`). Homogeneous paths tend to represent meaningful chains of
  connections rather than noise.
- **A maximum crawl depth** (`maxPathLength`) can be defined; resources too far
  from the seeds are usually less relevant.
- **Predicate limitations** (whitelist/blacklist) and **directionality** further
  focus the crawl (see [Crawl configuration](#crawl-configuration)).

---

## Architecture

Derzis is a distributed, manager/worker system. All components are written in
TypeScript/Node.js and communicate over a Redis message bus, with MongoDB as the
persistent store.

```
                ┌────────────┐      Redis pub/sub       ┌────────────┐
                │  Manager   │ ───────────────────────► │  Worker(s) │
                │ (SvelteKit)│ ◄─────────────────────── │ (Node.js)  │
                └─────┬──────┘                          └─────┬──────┘
                      │                                        │
                      ▼                                        ▼
                 ┌─────────┐                              HTTP (Linked Data)
                 │ MongoDB │                              + robots.txt checks
                 └─────────┘
```

| Component     | Package            | Role                                                                                                                                                              |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manager**   | `derzis-manager`   | SvelteKit web UI + REST API. Decides what to crawl next, distributes jobs to workers, persists data, exposes live progress over Server-Sent Events.               |
| **Worker**    | `derzis-worker`    | Standalone Node.js service. Fetches `robots.txt`, dereferences resource IRIs (with content negotiation), parses RDF, and reports results back over Redis.         |
| **Validator** | `derzis-validator` | CLI / Express tool for validation and comparison of crawled data (e.g. diffing exports, viewing graphs).                                                          |
| **Models**    | `@derzis/models`   | MongoDB data models (TypeGoose): `Domain`, `Resource`, `Triple`, `Process`, `Path` (with `TraversalPath` / `EndpointPath` discriminators), `ProcessDoneResource`. |
| **Common**    | `@derzis/common`   | Shared utilities, types, and logging (`createLogger`).                                                                                                            |
| **Config**    | `@derzis/config`   | Configuration loader (environment variables + dotenv).                                                                                                            |

The Manager, each Worker, the database and Redis can all run on separate machines,
making the crawler horizontally scalable.

### Path model: traversal vs. endpoint

Derzis tracks two kinds of paths (both stored as `Path` discriminator documents):

- **`TraversalPath`** — the default. A path rooted at a seed, extended by following
  triples whose subject/object becomes the new path _head_ (a URL resource).
- **`EndpointPath`** — used when a crawl step is configured to
  `convertToEndpointPaths`. Active traversal paths are converted into endpoint
  paths that additionally record the **shortest path length** to reach each head and
  the set of **`seedPaths`** (per-seed distances). An endpoint path head may be a
  URL _or a literal_ value, capturing the terminal nodes of a property path.

---

## How a crawl works

A crawl is organised as a **Process** made of ordered **Steps**. Each step takes the
current set of seed resources (plus any newly discovered seeds) and expands the
active paths according to the step's configuration.

1. For every active path, its current _head_ resource is queued for dereferencing.
   The Manager claims the domain (so only one worker touches it at a time) and
   respects `robots.txt` rules and the `Crawl-Delay` directive.
2. The Worker dereferences the resource (HTTP `GET` with RDF `Accept` headers,
   falling back to `Link`/`<link>` metadata when the server does not honour content
   negotiation), parses the RDF, and returns the triples.
3. Each triple is used to **extend** the path: if the path restrictions are still
   satisfied (length, distinct properties, predicate limitations, directionality),
   a new path is created with the triple's subject or object as the new head.
4. Paths that violate restrictions, or whose head has already been fully visited,
   are marked finished.
5. When no active paths remain, the step completes; a new step may be added to
   continue crawling (possibly with different restrictions or converting to endpoint
   paths).

The restricted graph can then be exported as RDF (see [Exports](#exports)).

---

## Crawl configuration

Each step (`StepClass`) supports the following parameters:

| Parameter                | Default | Description                                                                                                                                                               |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seeds`                  | —       | Seed resource IRIs to start/continue crawling from.                                                                                                                       |
| `maxPathLength`          | `2`     | Maximum number of nodes (depth) in a path.                                                                                                                                |
| `maxPathProps`           | `1`     | Maximum number of **distinct** properties allowed in a path.                                                                                                              |
| `predLimit`              | —       | _(Deprecated)_ Simple whitelist/blacklist of predicates. Use `predLimitations`.                                                                                           |
| `predLimitations`        | `[]`    | Per-predicate limitations with `past`/`future` constraints (whitelist/blacklist).                                                                                         |
| `followDirection`        | `false` | Whether to enforce predicate directionality when extending paths.                                                                                                         |
| `predsDirection`         | `[]`    | Per-predicate direction metadata (`subject` \| `object` \| `none`, plus a `ratio`). Required for `followDirection` to be meaningful; if missing, all triples are allowed. |
| `resetErrors`            | `false` | Reset `error` statuses of resources, domains and paths at the start of the step.                                                                                          |
| `convertToEndpointPaths` | `false` | After this step's expansion, convert active `TraversalPath`s into `EndpointPath`s.                                                                                        |

Predicate **directionality** is computed from branch-factor statistics (how often a
predicate points subject→object vs object→subject) and stored explicitly per step as
`predsDirection`. When `followDirection` is enabled, only triples matching the
expected direction are followed.

---

## Repository layout

This is a TypeScript monorepo (npm workspaces / project references):

```
derzis-dev/
├── common/      @derzis/common      shared utilities & logging
├── config/      @derzis/config      configuration loader
├── models/      @derzis/models      MongoDB models & aggregation logic
├── manager/     derzis-manager      SvelteKit UI + REST API
├── worker/      derzis-worker       background crawl worker
├── validator/   derzis-validator    validation & comparison CLI
├── docker-compose.yml               full-stack local deployment
└── AGENTS.md                     guidance for AI agents working on the code
```

---

## Getting started

### Prerequisites

- Node.js (see individual package `engines`/`package.json`)
- A running **MongoDB** and **Redis** instance (or use Docker Compose)
- npm

### Option A — Docker Compose (recommended for the full stack)

Copy the environment file and start everything:

```bash
cp .env.example .env
docker compose up --build --watch --remove-orphans
```

This starts:

| Service   | Port (configurable) | Notes                    |
| --------- | ------------------- | ------------------------ |
| MongoDB   | `60001`             | persisted to `./data/db` |
| Redis     | `60002`             | pub/sub bus              |
| Manager   | `60003`             | web UI + API             |
| Worker    | —                   | background service       |
| Validator | `60004`             | validation/comparison UI |

The manager dev server can also be run directly with `npm run dev` (default SvelteKit
port `5173`, preview `4173`).

### Option B — Local development

Assuming MongoDB, Redis (and optionally a Fuseki/SPARQL endpoint) are already running:

```bash
# Terminal 1 — Manager
cd manager && npm install && npm run dev

# Terminal 2 — Worker
cd worker && npm install && npm run dev
```

The Manager log file is `manager/logs/current`; the Worker log is `worker/logs/current`.

### Environment

Configuration is loaded from environment variables via `@derzis/config`. Copy
`.env.example` to `.env` and adjust ports, hosts, database names and the crawl delay
(`config.http.crawlDelay`). Secrets (MongoDB URI, Redis URL, API tokens) must come
from the environment — never commit them.

### Resetting the database

```bash
cd manager
npm run db:drop:dev     # drop development database
npm run db:drop:test    # drop test database
npm run db:setup:test   # seed test data
```

---

## Usage

### Web UI

Open the Manager in a browser (e.g. <http://localhost:60003> or
<http://localhost:5173> in dev). From there you can:

- create a crawl **Process** with seed resources and step parameters;
- watch live progress (Server-Sent Events) including per-step `extending` /
  `crawling` progress, crawl rate and ETA;
- inspect domains, resources, paths and triples;
- view computed metrics (branch factors, seed predicates, global statistics);
- export the crawled graph.

### REST API

The Manager exposes a REST API under `/api/processes`:

| Endpoint                                                                    | Purpose                                  |
| --------------------------------------------------------------------------- | ---------------------------------------- |
| `GET  /api/processes`                                                       | list processes                           |
| `POST /api/processes`                                                       | create a process with seeds + first step |
| `GET  /api/processes/[pid]`                                                 | process details                          |
| `POST /api/processes/[pid]/add-step`                                        | append a crawl step                      |
| `GET  /api/processes/[pid]/events`                                          | SSE live progress stream                 |
| `GET  /api/processes/[pid]/metrics`                                         | crawl metrics                            |
| `GET  /api/processes/[pid]/stats`                                           | statistics                               |
| `GET  /api/processes/[pid]/calc-metrics/{branch-factors,global,seed-preds}` | compute metric batches                   |
| `GET  /api/processes/[pid]/triples.nt.gz`                                   | export as gzipped N-Triples              |
| `GET  /api/processes/[pid]/triples.json.gz`                                 | export as gzipped JSON                   |
| `GET  /api/processes/[pid]-full.zip`                                        | full export bundle                       |

> **API note:** `add-step` now expects `predsDirection` (an array of
> `{ url, direction, ratio }`). The legacy `predsBranchFactor` field is rejected
> with HTTP 400.

### Exports

The crawled (restricted) graph can be exported in RDF or JSON form and used with
other tools, or loaded into the **Validator** for diffing and graph visualisation.

---

## Development

Each package has its own scripts; run them from within the package directory.

| Package     | Notable scripts                                                                          |
| ----------- | ---------------------------------------------------------------------------------------- |
| `common`    | `typecheck`, `lint`, `format`, `test` (Vitest)                                           |
| `config`    | (library only)                                                                           |
| `models`    | `typecheck`, `lint`, `format`, `test` (Vitest)                                           |
| `manager`   | `dev`, `build`, `preview`, `check`, `test:unit`, `test:integration` (Playwright), `db:*` |
| `worker`    | `dev`, `build`, `preview`, `test`, `typecheck`, `eslint`                                 |
| `validator` | `typecheck`, `lint`, `format`, `test`                                                    |

Type-check every package:

```bash
for p in common models manager worker validator; do (cd $p && npm run typecheck); done
```

The repository follows [Conventional Commits](https://www.conventionalcommits.org/).
See `AGENTS.md` for detailed coding conventions, the index-sync caveats, and the
monorepo path aliases (`@derzis/models`, `@derzis/common`, `@derzis/config`).

### Testing

- **Unit tests** (Vitest) live next to the code they test (e.g. `models/*.test.ts`,
  `manager/src/**/test.ts`).
- **Integration tests** (Playwright) live in `manager/tests/` and run against the
  built app on port `4173`.

---

## License

Derzis is released under the ISC license. See `LICENSE.md` for details.

## Citation

If you use Derzis in your research, please cite:

> André F. Santos and José P. Leal. _Derzis: a path aware linked data crawler_.
> In Ricardo Queirós, Mário Pinto, Alberto Simões, Filipe Portela, and Maria João
> Pereira, editors, 10th Symposium on Languages, Applications and Technologies
> (SLATE 2021), OASIcs, Vol. 94, Article 1, 2021.
