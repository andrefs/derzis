import mongoose from 'mongoose';
import config from '@derzis/config';

const MIGRATION_NAME = 'migrate-triples';

interface OldTripleDocument {
  _id: mongoose.Types.ObjectId;
  subject: string;
  predicate: string;
  object?: string;
  objectLiteral?: {
    value: string;
    datatype?: string;
    language?: string;
  };
  nodes?: string[];
  sources?: string[];
  createdAt: Date;
  updatedAt: Date;
}

async function buildUri(cfg: { host: string; port: string; name: string; user?: string; pass?: string }): Promise<string> {
  const host = cfg.host;
  const port = cfg.port;
  const name = cfg.name;
  const user = cfg.user;
  const pass = cfg.pass;

  const creds = user && pass ? `${user}:${pass}@` : '';
  return `mongodb://${creds}${host}:${port}/${name}`;
}

async function migrate() {
  console.log(`Starting migration: ${MIGRATION_NAME}`);

  const uri = await buildUri(config.manager.db);
  console.log('Connecting to:', uri.replace(/\/\/.*:.*@/, '//***:***@'));

  await mongoose.connect(uri);

  const db = mongoose.connection.db!;
  const triplesCollection = db.collection<OldTripleDocument>('triples');

  const count = await triplesCollection.countDocuments();
  console.log(`Found ${count} triples to migrate`);

  if (count === 0) {
    console.log('No triples to migrate. Exiting.');
    await mongoose.disconnect();
    return;
  }

  const BATCH_SIZE = 500;
  let migrated = 0;
  let namedNodeCount = 0;
  let literalCount = 0;
  let skipped = 0;

  const namedNodeTriplesCollection = db.collection('namedNodeTriples');
  const literalTriplesCollection = db.collection('literalTriples');

  try {
    await namedNodeTriplesCollection.createIndex({ subject: 1, predicate: 1, object: 1 }, { unique: true });
  } catch (e) {
    console.log('Index on namedNodeTriples already exists');
  }
  try {
    await literalTriplesCollection.createIndex(
      { subject: 1, predicate: 1, 'object.value': 1, 'object.language': 1, 'object.datatype': 1 },
      { unique: true }
    );
  } catch (e) {
    console.log('Index on literalTriples already exists');
  }

  const cursor = triplesCollection.find<OldTripleDocument>({});

  while (await cursor.hasNext()) {
    const batch: OldTripleDocument[] = [];
    for (let i = 0; i < BATCH_SIZE && (await cursor.hasNext()); i++) {
      const doc = await cursor.next();
      if (doc) batch.push(doc);
    }

    const namedNodeOps: any[] = [];
    const literalOps: any[] = [];

    for (const triple of batch) {
      if (triple.object !== null && triple.object !== undefined && triple.object !== '') {
        namedNodeOps.push({
          insertOne: {
            document: {
              subject: triple.subject,
              predicate: triple.predicate,
              object: triple.object,
              nodes: [triple.subject, triple.object],
              sources: triple.sources || [],
              createdAt: triple.createdAt,
              updatedAt: triple.updatedAt
            }
          }
        });
        namedNodeCount++;
      }
      else if (triple.objectLiteral && triple.objectLiteral.value) {
        literalOps.push({
          insertOne: {
            document: {
              subject: triple.subject,
              predicate: triple.predicate,
              object: {
                value: triple.objectLiteral.value,
                language: triple.objectLiteral.language,
                datatype: triple.objectLiteral.datatype
              },
              nodes: [triple.subject],
              sources: triple.sources || [],
              createdAt: triple.createdAt,
              updatedAt: triple.updatedAt
            }
          }
        });
        literalCount++;
      } else {
        skipped++;
        console.warn('Skipping invalid triple:', triple._id);
      }
    }

    if (namedNodeOps.length > 0) {
      try {
        await namedNodeTriplesCollection.bulkWrite(namedNodeOps, { ordered: false });
      } catch (e) {
      }
    }

    if (literalOps.length > 0) {
      try {
        await literalTriplesCollection.bulkWrite(literalOps, { ordered: false });
      } catch (e) {
      }
    }

    migrated += batch.length;
    console.log(`Progress: ${migrated}/${count} (NamedNode: ${namedNodeCount}, Literal: ${literalCount}, Skipped: ${skipped})`);
  }

  console.log('\n=== Migration Complete ===');
  console.log(`Total processed: ${migrated}`);
  console.log(`NamedNode triples: ${namedNodeCount}`);
  console.log(`Literal triples: ${literalCount}`);
  console.log(`Skipped: ${skipped}`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
