# derzis


## Dependencies


## Running locally

### Manager

You can run the Manager locally by running

```bash
cd manager
npm run dev
```

You can also use Docker:

```bash
docker compose up --build --watch --remove-orphans manager
```

### Worker

You can run the Worker locally by running

```bash
cd worker
npm run dev
```

You can also use Docker:

```bash
docker compose up --build --remove-orphans manager
```

## Clear development databases

```bash
cd manager
npm run db:drop:dev
```
