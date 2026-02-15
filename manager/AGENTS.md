# Derzis Manager - Agent Instructions

This document provides comprehensive guidelines for AI agents working on the Derzis Manager codebase, a Linked Data crawler built with SvelteKit and TypeScript.

## Project Overview

Derzis Manager is a web application for managing Linked Data crawling processes. It provides a web interface for creating, monitoring, and managing crawling processes that discover and extract RDF triples from the web.

## Build, Lint, and Test Commands

### Development

- `npm run dev` - Start development server with Vite
- `npm run serve` - Start development server with host binding
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build locally

### Code Quality

- `npm run lint` - Run Prettier and ESLint checks
- `npm run format` - Auto-format code with Prettier
- `npm run check` - Run SvelteKit sync and type checking
- `npm run check:watch` - Watch mode for type checking
- `npm run typecheck` - TypeScript compilation check
- `npm run typecheck:watch` - Watch mode for TypeScript checking

### Testing

- `npm test` - Run all tests (integration + unit)
- `npm run test:unit` - Run unit tests with Vitest
- `npm run test:integration` - Run integration tests with Playwright

### Running a Single Test

- **Unit test**: `npx vitest run path/to/test.file.ts`
- **Integration test**: `npx playwright test path/to/test.spec.ts`
- **Specific test pattern**: `npx vitest run -t "test name pattern"`

### Database

- `npm run db:drop:dev` - Drop development database

## Code Style Guidelines

### TypeScript Configuration

- **Strict mode enabled**: All TypeScript strict checks are active
- **Target**: ES modules with modern JavaScript features
- **Module resolution**: Node.js style with path mapping
- **Source maps**: Enabled for debugging

### Import Organization

```typescript
// External library imports first
import robotsParser from 'robots-parser';
import config from '@derzis/config';

// Type imports (if needed separately)
import type { JobResult, RobotsCheckResult } from '@derzis/common';

// Local imports
import RunningJobs from './RunningJobs';
import type { JobCapacity, JobRequest } from '@derzis/common';

// Standard library imports
import { ObjectId } from 'bson';
```

### Path Aliases

Use the configured path aliases for clean imports:

- `$lib` - `./src/lib`
- `@derzis/models` - `../models/src`
- `@derzis/common` - `../common/src`
- `@derzis/config` - `../config/src`
- `@derzis/manager` - `./src/lib`

### Naming Conventions

#### Variables and Functions

- Use `camelCase` for variables and functions
- Use descriptive names: `jobResult`, `maxPathLength`, `uniqueSeeds`
- Boolean variables: `isJobRegistered`, `hasErrors`

#### Classes and Types

- Use `PascalCase` for classes and interfaces
- Type names: `JobResult`, `ProcessClass`, `RecursivePartial`

#### Files

- Components: `ComponentName.svelte`
- Server files: `+page.server.ts`, `+server.ts`
- Utilities: `utils.ts`, `process-helper.ts`

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

#### Type Guards and Assertions

```typescript
// Type assertion with confidence
const seeds: string[] = (data.get('seeds') as string)
  ?.split(/\s*[\n,]\s*/)
  .filter((s: string) => !s.match(/^\s*$/));

// Type narrowing
if (jobResult.jobType === 'robotsCheck') {
  // jobResult is now narrowed to robotsCheck type
}
```

#### Generic Types

```typescript
type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends object ? RecursivePartial<T[P]> : T[P];
};
```

### Error Handling

- Use try-catch blocks for async operations
- Log errors with context using the logger
- TODO comments for known error cases that need handling
- Graceful degradation where appropriate

### Async/Await Patterns

```typescript
async function updateJobResults(jobResult: JobResult) {
  try {
    await this.saveRobots(jobResult);
  } catch (e) {
    // Handle error appropriately
    log.error('Failed to save robots data', { error: e });
  }
}
```

### Logging

- Use the centralized logger: `import { createLogger } from '@derzis/common'`
- Log levels: `log.debug()`, `log.info()`, `log.warn()`, `log.error()`
- Include relevant context in log objects

### SvelteKit Specific Patterns

#### Server Load Functions

```typescript
export async function load() {
  const data = await fetchData();
  return {
    data: structuredClone(data) // Use structuredClone for complex objects
  };
}
```

#### Actions

```typescript
export const actions = {
  actionName: async ({ request }) => {
    const data = await request.formData();
    // Process form data
    throw redirect(303, '/success-page');
  }
};
```

#### Component Scripts

```svelte
<script lang="ts">
  import { Row, Col, Table } from '@sveltestrap/sveltestrap';

  export let data;
  // Component logic
</script>
```

### Svelte Component Style

- Use TypeScript in script blocks: `<script lang="ts">`
- Import components from sveltestrap for Bootstrap styling
- Use Svelte's reactive statements and stores as needed
- Follow Bootstrap class conventions for responsive design

### Testing Patterns

#### Unit Tests (Vitest)

```typescript
import { describe, it, expect } from 'vitest';

describe('Manager class', () => {
  it('should initialize with empty jobs', () => {
    const manager = new Manager();
    expect(manager.jobs).toBeInstanceOf(RunningJobs);
  });
});
```

#### Integration Tests (Playwright)

- Tests run against built application on port 4173
- Located in `tests/` directory
- Test file pattern: `*.test.ts` or `*.spec.ts`

### Commit Message Conventions

Follow conventional commit format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

### Code Organization

- **Routes**: Page components in `src/routes/`
- **Libraries**: Reusable code in `src/lib/`
- **Types**: Type definitions in relevant files or dedicated type files
- **Utils**: Utility functions in `src/lib/utils.ts`
- **Constants**: Configuration in appropriate config files

### Security Considerations

- Never log sensitive data (passwords, tokens, keys)
- Validate input data thoroughly
- Use environment variables for configuration
- Follow principle of least privilege

### Performance Guidelines

- Use `structuredClone()` for complex object duplication
- Optimize database queries with `.lean()` where appropriate
- Implement proper error boundaries in UI components
- Use lazy loading for heavy components if needed

## Monorepo Structure

This project is part of a larger monorepo with related packages:

- `@derzis/models` - Data models
- `@derzis/common` - Shared utilities and types
- `@derzis/config` - Configuration management
- `@derzis/worker` - Background processing worker

When making changes, ensure compatibility across all packages.</content>
<parameter name="filePath">AGENTS.md
