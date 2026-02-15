import yauzl from 'yauzl';
import { checkPreConditions, cmpCounts } from '../lib/cmp-results';

import { ProcessInfo } from '../lib/types';
import { humanizeDelta } from '../lib/jdp-humanize';
import { SimpleTriple } from '@derzis/common';
import { diffTripleArrays } from '../lib/diff';

async function loadJsonFromZip<T>(zipPath: string, filePath: string | RegExp): Promise<T> {
  try {
    const content = await loadFileFromZip(zipPath, filePath);
    return JSON.parse(content) as T;
  } catch (err) {
    throw new Error(`Error loading or parsing ${filePath} from ${zipPath}: ${err}`);
  }
}

async function loadFileFromZip(zipPath: string, filePath: string | RegExp): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    return yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err);

      let found = false;

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (
          (filePath instanceof RegExp && filePath.test(entry.fileName)) ||
          entry.fileName === filePath
        ) {
          found = true;
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err || !readStream) {
              zipfile.close();
              return reject(err);
            }
            const chunks: Buffer[] = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              zipfile.close();
              return resolve(Buffer.concat(chunks).toString('utf-8'));
            });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        if (!found) {
          zipfile.close();
          reject(new Error(`File ${filePath} not found in zip ${zipPath}`));
        }
      });

      zipfile.on('error', (err) => {
        zipfile.close();
        return reject(err);
      });
    });
  });
}

async function cmpGraphs(zip1: string, zip2: string) {
  const info1 = await loadJsonFromZip<ProcessInfo>(zip1, 'info.json');
  const info2 = await loadJsonFromZip<ProcessInfo>(zip2, 'info.json');
  const checkPC = checkPreConditions(info1, info2);
  console.log('Pre-conditions match:', checkPC);

  // compare counts
  const countDelta = cmpCounts(info1, info2);
  if (countDelta) {
    console.log('Count differences:', humanizeDelta(countDelta));
  } else {
    console.log('No count differences');
  }

  // compare triples
  const triples1 = await loadJsonFromZip<SimpleTriple[]>(zip1, /.*-triples\.json$/);
  const triples2 = await loadJsonFromZip<SimpleTriple[]>(zip2, /.*-triples\.json$/);

  const delta = diffTripleArrays(triples1, triples2);
  if (delta) {
    console.log('Triple differences:', humanizeDelta(delta));
  } else {
    console.log('No triple differences');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('Usage: ts-node cmp-results.ts <zip1> <zip2>');
    process.exit(1);
  }

  const [zip1, zip2] = args;
  await cmpGraphs(zip1, zip2);
}

main()
  .catch((err) => {
    console.error('Error in main:', err);
    process.exit(1);
  })
  .then(() => {
    //console.log('Done');
    process.exit(0);
  });
