import yauzl from 'yauzl';
import { cmpGraphPreConds } from '../lib/cmp-results';

import { ProcessInfo } from '../lib/types';


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
  const checkPC = await checkPreConditions(zip1, zip2);
  console.log('Pre-conditions match:', checkPC);

  // compar
}


async function checkPreConditions(zip1: string, zip2: string) {
  try {
    const [infoStr1, infoStr2] = await Promise.all([
      loadFileFromZip(zip1, 'info.json'),
      loadFileFromZip(zip2, 'info.json'),
    ]).catch((err) => {
      console.error('Error loading info.json from zips:', err);
      throw err;
    });

    const info1: ProcessInfo = JSON.parse(infoStr1);
    const info2: ProcessInfo = JSON.parse(infoStr2);

    return cmpGraphPreConds(info1, info2);
  }
  catch (err) {
    console.error('Error checking pre-conditions:', err);
    return false;
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

main().catch((err) => {
  console.error('Error in main:', err);
  process.exit(1);
}).then(() => {
  //console.log('Done');
  process.exit(0);
});


