# Derzis - Agent Instructions

This document provides comprehensive guidelines for AI agents working on the Derzis codebase, a Linked Data crawler system built with TypeScript in a monorepo architecture.

## Project Overview

Derzis is a distributed system for discovering and extracting RDF triples from the web. It follows a manager/worker pattern with Redis-based message queueing and MongoDB for persistent storage. The system provides both a web-based UI for monitoring/controlling crawls and a background worker service for processing crawl tasks.

## Architecture Overview

### Components

- **Manager** (`derzis-manager`) - SvelteKit web application providing UI and REST API (port 5173 dev, 4173 preview)
- **Worker** (`derzis-worker`) - Standalone Node.js service executing crawl tasks in background
- **Validator** (`derzis-validator`) - CLI tool for validation and data comparison (port 60004)
- **Common** (`@derzis/common`) - Shared utilities, logging, and type definitions
- **Config** (`@derzis/config`) - Configuration loading and environment management
- **Models** (`@derzis/models`) - MongoDB data models and schemas using TypeGoose

### Technology Stack

- **Language**: TypeScript (strict mode)
- **Frontend**: SvelteKit 2.x, Vite, Bootstrap 5
- **Backend**: Node.js, Express.js (API routes)
- **Database**: MongoDB with TypeGoose ODM
- **Message Queue**: Redis pub/sub
- **Logging**: pino (common), winston (worker)
- **Testing**: Vitest (unit), Playwright (integration)
- **Graph Analysis**: graphology, sigma.js
- **RDF Processing**: n3, rdf-parse, rdf-string
- **Containerization**: Docker Compose

## Package-Specific Guidelines

### @derzis/common

Shared utilities and logging infrastructure.

**Scripts**:
- `npm run typecheck` - TypeScript compilation check
- `npm run lint` - Prettier check
- `npm run eslint` - ESLint check
- `npm run format` - Auto-format with Prettier
- `npm run test` - Run unit tests with Vitest

**Usage Notes**:
- Provides `createLogger()` for structured logging
- Export shared types used across packages
- Follow Node.js utility patterns

### @derzis/config

Configuration management with dotenv integration.

**Scripts**: No scripts (library only)

**Usage Notes**:
- Simple configuration loader
- Import and use: `import config from '@derzis/config'`
- Environment variables loaded automatically

### @derzis/models

Database models and MongoDB connection logic.

**Scripts**:
- `npm run typecheck`
- `npm run lint`
- `npm run eslint`
- `npm run format`
- `npm run test`

**Usage Notes**:
- Defines Domain, Resource, Triple, Process, Path models
- Includes `connect-db.ts` for database connection
- Use TypeGoose decorators for schema definitions
- Test database interactions thoroughly

### derzis-manager

SvelteKit web application with UI and API.

**Scripts**:
- `npm run dev` - Start development server
- `npm run serve` - Start with host binding
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build
- `npm run test` - Run all tests (integration + unit)
- `npm run test:unit` - Unit tests with Vitest
- `npm run test:integration` - Integration tests with Playwright
- `npm run check` - SvelteKit sync + type checking
- `npm run lint` - Prettier check
- `npm run format` - Auto-format
- `npm run typecheck` - TypeScript check
- `npm run db:drop:dev` - Drop development database
- `npm run db:drop:test` - Drop test database
- `npm run db:setup:test` - Setup test data

**Specific Patterns**:
- SvelteKit load functions and actions
- Use `$lib` alias for local imports
- Bootstrap via sveltestrap components
- API routes in `src/routes/api/`
- Server-only code in `+server.ts` files

### derzis-worker

Background processing worker for crawling tasks.

**Scripts**:
- `npm run dev` - Start worker with ts-node
- `npm run build` - Compile TypeScript and replace paths
- `npm run preview` - Run compiled worker from dist/
- `npm run test` - Unit tests
- `npm run test:watch` - Watch mode tests
- `npm run typecheck` - TypeScript check
- `npm run typecheck:watch` - Watch mode type checking
- `npm run lint` - Prettier check
- `npm run format` - Auto-format
- `npm run eslint` - ESLint check

**Specific Patterns**:
- Entry point: `src/bin/worker.ts`
- Uses winston for logging (different from common)
- Communicates via Redis pub/sub
- Processes crawl jobs from queue

### derzis-validator

Validation and comparison CLI tool.

**Scripts**:
- `npm run typecheck`
- `npm run lint`
- `npm run eslint`
- `npm run format`
- `npm run test`

**Usage Notes**:
- Express server with Handlebars views
- CLI tools in `src/bin/`
- Comparison logic using jsondiffpatch, deep-object-diff

## General Development Guidelines

### TypeScript Configuration

- **Strict mode**: All packages use strict TypeScript checks
- **Target**: ESNext with modern features
- **Module resolution**: Node.js with path mapping for monorepo packages
- **Build**: Use `tsc -b` for project references where applicable

### Import Organization

```typescript
// External library imports first
import express from 'express';
import { createClient } from 'redis';

// Monorepo package imports
import config from '@derzis/config';
import { Resource } from '@derzis/models';
import { createLogger } from '@derzis/common';

// Type imports (separate if needed)
import type { RedisClientType } from 'redis';

// Standard library imports
import { readFile } from 'fs/promises';

// Local relative imports (within package)
import { helper } from './utils';
import type { LocalType } from './types';
```

### Path Aliases

Monorepo-wide aliases defined in root `tsconfig.json`:

- `@derzis/models` → `./models/src`
- `@derzis/common` → `./common/src`
- `@derzis/config` → `./config/src`

Package-specific aliases (varies by package):
- Manager: `$lib` → `./src/lib`
- Worker/Validator: similar patterns

### Naming Conventions

- **Variables/Functions**: `camelCase` (e.g., `jobResult`, `maxPathLength`)
- **Boolean flags**: `is*`, `has*`, `should*` (e.g., `isConnected`, `hasErrors`)
- **Classes/Types/Interfaces**: `PascalCase` (e.g., `CrawlJob`, `Resource`)
- **Files**:
  - Svelte components: `ComponentName.svelte`
  - Server routes: `+server.ts`, `+page.server.ts`
  - Utilities: `utils.ts`, `helper.ts`
  - Entry points: `worker.ts`, `index.ts`

### TypeScript Patterns

#### Interface Definitions

```typescript
interface ProcessClass {
  pid: string;
  steps: StepClass[];
  currentStep: StepClass;
  status: ProcessStatus;
  createdAt?: Date;
}
```

#### Type Guards

```typescript
if (jobResult.jobType === 'crawl') {
  // jobResult narrowed to specific type
}
```

#### Generic Types

```typescript
type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends object ? RecursivePartial<T[P]> : T[P];
};
```

### Error Handling

- Always use try-catch for async operations
- Log errors with context: `log.error('Operation failed', { error, context })`
- Graceful degradation where appropriate
- Throw meaningful errors with clear messages
- TODO comments for known error cases needing handling

### Async/Await

```typescript
async function processJob(jobId: string) {
  try {
    const job = await fetchJob(jobId);
    await processTask(job);
  } catch (error) {
    log.error('Job processing failed', { jobId, error });
    throw error; // or handle gracefully
  }
}
```

### Logging

- Use centralized logger from `@derzis/common`: `import { createLogger } from '@derzis/common'`
- Log levels: `debug()`, `info()`, `warn()`, `error()`, `silly()`
- Include contextual data in log objects
- **Never log sensitive data**: passwords, tokens, keys, personal info
- Worker uses winston - follow that package's logger patterns

### Code Organization

- **Routes**: Manager in `src/routes/`, Worker/Validator in `src/routes/` or defined in Express app
- **Libraries**: Reusable code in `src/lib/`
- **Utils**: Utility functions in `src/lib/utils.ts` or dedicated files
- **Types**: Co-locate with usage or in dedicated `types.ts` files
- **Constants**: Configuration files or `src/lib/constants.ts`

### Security Considerations

- **Never log sensitive data** - use redaction if needed
- Validate all input data (API requests, user input)
- Use environment variables for secrets (MongoDB URI, Redis password, API keys)
- Follow principle of least privilege for database access
- Sanitize user-provided URLs and content
- Implement proper CORS and rate limiting in API routes

### Performance Guidelines

- Use `structuredClone()` for complex object duplication
- Optimize MongoDB queries with `.lean()` when no document methods needed
- Implement proper error boundaries in UI components
- Use lazy loading for heavy components
- Batch database writes when possible
- Cache expensive computations
- Use Redis efficiently - avoid blocking operations

## Commit Message Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, semicolons, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks (dependencies, build, etc.)

Examples:
```
feat(manager): add crawl job cancellation
fix(worker): retry on Redis connection failure
docs(common): update logger usage examples
test(models): add tests for Resource validation
```

## Testing Strategy

### Unit Tests (Vitest)

- Location: Package-specific (e.g., `manager/src/routes/.../test.ts`, `models/*.test.ts`)
- Run: `npm test` or `npm run test:unit` (manager)
- Use `describe`, `it`, `expect` pattern
- Mock dependencies appropriately
- Coverage encouraged for critical logic

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Resource Model', () => {
  it('should validate required fields', () => {
    expect(() => new Resource({})).toThrow();
  });
});
```

### Integration Tests (Manager)

- Uses Playwright
- Run: `npm run test:integration` in manager package
- Tests located in `manager/tests/`
- Tests run against built app on port 4173
- Use page fixtures and test data setup scripts

### Cross-Package Testing

- Test inter-package imports work correctly
- Ensure path aliases resolve in all packages
- Run `typecheck` at root to verify all packages compile

## Cross-Package Development

### Dependency Management

- Packages can depend on other `@derzis/*` packages via path aliases
- Avoid circular dependencies
- Shared types belong in `@derzis/common`
- Shared logic should be extracted to `@derzis/common` or `@derzis/config`

### Making Changes Across Packages

1. Update interface/type in source package (e.g., `@derzis/models`)
2. Update dependent packages to use new type
3. Run `typecheck` in all affected packages
4. Ensure tests pass in all packages
5. Verify monorepo imports still work

### TypeScript Type Checking

Root `tsconfig.json` provides project references. To typecheck all packages:

```bash
# Run in each package, or create a script
cd common && npm run typecheck
cd models && npm run typecheck
cd manager && npm run typecheck
cd worker && npm run typecheck
cd validator && npm run typecheck
```

## Setup and Environment

### Environment Configuration

- Copy `.env.example` to `.env` at root
- Configure MongoDB URI, Redis URL, ports as needed
- Environment variables loaded by `@derzis/config` automatically

```env
MONGODB_URI=mongodb://localhost:60001/derzis
REDIS_URL=redis://localhost:60002
MANAGER_PORT=5173
WORKER_CONCURRENCY=5
```

### Docker Compose (Recommended for full stack)

```bash
docker compose up --build --watch --remove-orphans
```

This starts:
- MongoDB on port 60001
- Redis on port 60002
- Manager on port 5173 (dev) / 4173 (preview)
- Worker as background service
- Validator on port 60004

### Local Development

```bash
# Assume MongoDB, Redis and Fuseki are already running

# Terminal 2: Start manager
cd manager && ./src/scripts/run-exp
# log file is manager/logs/current

# Terminal 3: Start worker
cd worker && ./src/bin/run-exp
# log file is worker/logs/current
```

### Database access (Manager)

You can use `mongosh` to access the drz-mng-local database.


## SvelteKit Specific (Manager Only)

### Load Functions

```typescript
export async function load() {
  const data = await fetchData();
  return { data: structuredClone(data) };
}
```

### Actions

```typescript
export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    // Process and redirect
    throw redirect(303, '/success');
  }
};
```

### Component Scripts

```svelte
<script lang="ts">
  import { Button, Table } from '@sveltestrap/sveltestrap';
  export let data;
</script>

<Button color="primary">Click me</Button>
```

## Additional Resources

- Root `README.md` - Project overview and setup
- Package-specific `README.md` files (if they exist) - Component details
- `docker-compose.yml` - Service definitions for full stack
- `tsconfig.json` - TypeScript configuration and path aliases

## Quick Reference: Package Commands

| Package | typecheck | lint | format | test | dev | build | preview |
|---------|-----------|------|--------|------|-----|-------|---------|
| common | ✓ | ✓ | ✓ | ✓ | - | - | - |
| config | - | - | - | - | - | - | - |
| models | ✓ | ✓ | ✓ | ✓ | - | - | - |
| manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| worker | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| validator | ✓ | ✓ | ✓ | ✓ | - | - | - |

**Legend**: ✓ = command exists, - = no command

Notes:
- Manager has additional commands: `test:integration`, `test:unit`, `db:*`
- Worker has `test:watch`, `typecheck:watch` variants
- Config has no scripts (pure library)

---

For package-specific details beyond what's covered here, refer to the individual package directories and their documentation. The `manager/AGENTS.md` file contains more extensive guidelines specific to the SvelteKit application.
