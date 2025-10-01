import yauzl from 'yauzl';
import { checkPreConditions } from '../lib/cmp-results';

import { ProcessInfo } from '../lib/types';


async function loadJsonFromZip<T>(zipPath: string, filePath: string): Promise<T> {
  try {
    const content = await loadFileFromZip(zipPath, filePath);
    return JSON.parse(content) as T;
  } catch (err) {
    throw new Error(`Error loading or parsing ${filePath} from ${zipPath}: ${err}`);
  }
}

async function loadFileFromZip(zipPath: string, filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    return yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err);

      let found = false;

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName === filePath) {
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

  // compare 
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

main().catch((err) => {
  console.error('Error in main:', err);
  process.exit(1);
}).then(() => {
  //console.log('Done');
  process.exit(0);
});


