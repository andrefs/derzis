import yauzl from 'yauzl';


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

    const info1 = JSON.parse(infoStr1);
    const info2 = JSON.parse(infoStr2);

    if (info1?.steps?.length !== info2?.steps?.length) {
      console.warn('Different number of steps');
      return false;
    }

    for (let i = 0; i < info1.steps.length; i++) {
      if (info1.steps[i].maxPathLength !== info2.steps[i].maxPathLength) {
        console.warn(`Different maxPathLength at step ${i}`);
        return false;
      }
      if (info1.steps[i].maxPathProps !== info2.steps[i].maxPathProps) {
        console.warn(`Different maxPathProps at step ${i}`);
        return false;
      }
      // compare "seeds" arrays
      const seeds1 = info1.steps[i].seeds || [];
      const seeds2 = info2.steps[i].seeds || [];
      if (seeds1.length !== seeds2.length || !seeds1.every((val: any, index: number) => val === seeds2[index])) {
        console.warn(`Different seeds at step ${i}`);
        return false;
      }

      // compare "whiteList" arrays
      const whiteList1 = info1.steps[i].whiteList || [];
      const whiteList2 = info2.steps[i].whiteList || [];
      if (whiteList1.length !== whiteList2.length || !whiteList1.every((val: any, index: number) => val === whiteList2[index])) {
        console.warn(`Different whiteList at step ${i}`);
        return false;
      }

      // compare "blackList" arrays
      const blackList1 = info1.steps[i].blackList || [];
      const blackList2 = info2.steps[i].blackList || [];
      if (blackList1.length !== blackList2.length || !blackList1.every((val: any, index: number) => val === blackList2[index])) {
        console.warn(`Different blackList at step ${i}`);
        return false;
      }

    }
  } catch (err) {
    console.error('Error checking pre-conditions:', err);
    return false;
  }

  return true;
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


