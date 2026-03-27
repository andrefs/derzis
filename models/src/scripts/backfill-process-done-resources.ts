/**
 * Backfill Migration Script: ProcessDoneResource and doneResourceCount
 *
 * This script:
 * 1. Creates ProcessDoneResource records for existing ProcessTriples
 * 2. Calculates doneResourceCount for existing processes
 *
 * Usage:
 *   npx ts-node src/scripts/backfill-process-done-resources.ts
 *
 * Warning: This processes ALL ProcessTriples in the database and may take a long time.
 * Consider running in batches for large datasets.
 */

import { db, Process, ProcessTriple, ProcessDoneResource, Resource, Triple } from '../index';
import { createLogger } from '@derzis/common/server';
import config from '@derzis/config';
import mongoose from 'mongoose';

const log = createLogger('backfill-process-done-resources');

async function main() {
  log.info('Starting ProcessDoneResource backfill migration');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/drz-mng-local';
  log.info(`Connecting to MongoDB: ${mongoUri}`);

  await db.connect(mongoUri);

  // Ensure indexes exist
  log.info('Ensuring ProcessDoneResource indexes exist');
  await ProcessDoneResource.syncIndexes();

  // Get all unique process IDs that have ProcessTriples
  log.info('Finding all unique process IDs...');
  const processIds = await ProcessTriple.distinct('processId');
  log.info(`Found ${processIds.length} processes to backfill`);

  let totalProcessed = 0;
  let totalCreated = 0;
  let totalErrors = 0;

  // Process each process in batches
  const batchSize = 100;
  const tripleBatchSize = 10000; // Process triples in smaller batches to avoid buffer overflow

  for (let i = 0; i < processIds.length; i += batchSize) {
    const batch = processIds.slice(i, i + batchSize);
    log.info(
      `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(processIds.length / batchSize)} (processes ${i + 1}-${Math.min(i + batchSize, processIds.length)})`
    );

    for (const processId of batch) {
      try {
        // Get all ProcessTriples for this process
        const processTriples = await ProcessTriple.find({ processId }).select('triple').lean();

        if (processTriples.length === 0) {
          continue;
        }

        // Get unique triple IDs
        const tripleIds = [...new Set(processTriples.map((pt) => pt.triple))];

        // Look up sources for these triples in batches
        const sourceUrls = new Set<string>();

        for (let j = 0; j < tripleIds.length; j += tripleBatchSize) {
          const tripleIdBatch = tripleIds.slice(j, j + tripleBatchSize);

          const triples = await Triple.find({ _id: { $in: tripleIdBatch } })
            .select('sources')
            .lean();

          // Collect all unique source URLs
          for (const triple of triples) {
            if (triple.sources && triple.sources.length > 0) {
              triple.sources.forEach((url) => sourceUrls.add(url));
            }
          }
        }

        if (sourceUrls.size === 0) {
          log.info(`No source URLs found for process ${processId}`);
          continue;
        }

        log.info(`Process ${processId}: Found ${sourceUrls.size} unique source URLs`);

        // Find Resource documents for these URLs in batches
        const resourceIds: mongoose.Types.ObjectId[] = [];
        const doneCount = { count: 0 };

        const urlArray = Array.from(sourceUrls);
        for (let j = 0; j < urlArray.length; j += 1000) {
          const urlBatch = urlArray.slice(j, j + 1000);

          const resources = await Resource.find({ url: { $in: urlBatch } })
            .select('_id url status')
            .lean();

          // Create ProcessDoneResource records
          const processDoneResources = resources.map((r) => ({
            processId: processId as string,
            resource: r._id
          }));

          if (processDoneResources.length > 0) {
            try {
              await ProcessDoneResource.insertMany(processDoneResources, { ordered: false });
              totalCreated += processDoneResources.length;
            } catch (err: any) {
              if (err.code === 11000) {
                // Duplicate key errors are expected - count how many were actually new
                const insertedCount = err.result?.nInserted || 0;
                totalCreated += insertedCount;
              } else {
                throw err;
              }
            }
          }

          // Count done resources
          doneCount.count += resources.filter((r) => r.status === 'done').length;
        }

        // Update the process with the calculated count
        await Process.updateOne(
          { pid: processId },
          { $set: { 'currentStep.doneResourceCount': doneCount.count } }
        );

        totalProcessed++;

        if (totalProcessed % 10 === 0) {
          log.info(
            `Progress: ${totalProcessed}/${processIds.length} processes processed, ${totalCreated} ProcessDoneResource records created`
          );
        }
      } catch (err) {
        totalErrors++;
        log.error(`Error processing process ${processId}:`, err);

        if (totalErrors > 10) {
          log.error('Too many errors, stopping migration');
          break;
        }
      }
    }

    if (totalErrors > 10) {
      break;
    }
  }

  log.info('=== Migration Complete ===');
  log.info(`Total processes processed: ${totalProcessed}`);
  log.info(`Total ProcessDoneResource records created: ${totalCreated}`);
  log.info(`Total errors: ${totalErrors}`);

  // Verify: Compare a few processes' counts with the old aggregation
  log.info('Verifying counts for sample processes...');

  const sampleProcesses = await Process.find({ status: 'done' })
    .select('pid currentStep.doneResourceCount')
    .limit(5)
    .lean();

  for (const proc of sampleProcesses) {
    log.info(`Process ${proc.pid}: doneResourceCount = ${proc.currentStep?.doneResourceCount}`);
  }

  await mongoose.disconnect();
  log.info('Migration finished, disconnected from MongoDB');

  process.exit(totalErrors > 10 ? 1 : 0);
}

main().catch((err) => {
  log.error('Migration failed:', err);
  process.exit(1);
});
