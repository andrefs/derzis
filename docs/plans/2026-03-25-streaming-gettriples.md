# Streaming getTriples Implementation Plan

> **For Claude:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix OOM in getTriples() by implementing cursor-based streaming instead of materializing all triples in memory.

**Architecture:** Replace the current implementation that loads all ProcessTriple and Triple documents into memory with a cursor-based streaming approach that processes triples in bounded batches.

**Tech Stack:** TypeScript, MongoDB/Mongoose, async generators

---

## Files to Modify

- `models/src/Process/process-data.ts` - Rewrite getTriples() to stream
- `manager/src/routes/api/processes/[pid]/triples.nt.gz/+server.ts` - Remove console.log per-quad logging

---

## Task 1: Rewrite getTriples() to use cursor-based streaming

**File:** `models/src/Process/process-data.ts:68-127`

**Step 1: Read current implementation**

Look at lines 68-127 of `models/src/Process/process-data.ts` to understand current implementation.

**Step 2: Write streaming implementation**

Replace the current `getTriples()` function with a cursor-based streaming version:

```typescript
export async function* getTriples(process: ProcessClass): AsyncGenerator<SimpleTriple> {
  const BATCH_SIZE = 1000;
  let lastId: Types.ObjectId | null = null;

  while (true) {
    // Build query with cursor pagination
    const query: QueryFilter<ProcessTripleDocument> = { processId: process.pid };
    if (lastId) {
      query._id = { $gt: lastId };
    }

    // Stream ProcessTriple IDs in batches
    const procTriples = await ProcessTriple.find(query)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('triple _id')
      .lean();

    if (procTriples.length === 0) {
      break;
    }

    const tripleIds = procTriples.map((pt) => pt.triple);
    lastId = procTriples[procTriples.length - 1]._id as Types.ObjectId;

    // Fetch triples for this batch
    const triples = await Triple.find({ _id: { $in: tripleIds } }).lean();

    // Build lookup map for this batch
    const tripleMap = new Map<string, TripleDocument>();
    for (const t of triples) {
      tripleMap.set(t._id.toString(), t);
    }

    // Yield triples in order
    for (const procTriple of procTriples) {
      const entry = tripleMap.get(procTriple.triple.toString());
      if (!entry) continue;

      if (isNamedNode(entry)) {
        const t = entry;
        yield {
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          type: TripleType.NAMED_NODE
        };
      } else if (isLiteral(entry)) {
        const t = entry;
        yield {
          subject: t.subject,
          predicate: t.predicate,
          object: { value: t.object.value, datatype: t.object.datatype, language: t.object.language },
          type: TripleType.LITERAL
        };
      }
    }
  }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd models && npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add models/src/Process/process-data.ts
git commit -m "fix(models): stream triples instead of materializing all in memory"
```

---

## Task 2: Remove per-quad logging in triples.nt.gz endpoint

**File:** `manager/src/routes/api/processes/[pid]/triples.nt.gz/+server.ts:34-35`

**Step 1: Remove console.log statement**

Change line 34-35 from:
```typescript
readableStream.on('data', (quad: SimpleTriple) => {
  console.log('Processing quad:', quad);
```
to:
```typescript
readableStream.on('data', (quad: SimpleTriple) => {
  // Logging removed to prevent memory pressure during large exports
```

**Step 2: Verify TypeScript compiles**

Run: `cd manager && npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add manager/src/routes/api/processes/[pid]/triples.nt.gz/+server.ts
git commit -m "fix(manager): remove per-quad logging in triples export endpoint"
```

---

## Verification

1. Access the triples export endpoint for a large process and verify:
   - No OOM crash
   - Memory usage stays bounded
   - File downloads successfully

2. Monitor memory usage during export:
   - `top -p $(pgrep -f "node.*manager")`
   - Memory should stay relatively constant, not grow linearly with triple count

---

## Rollback Plan

If issues arise, revert with:
```bash
git revert HEAD
git revert HEAD~1
```
