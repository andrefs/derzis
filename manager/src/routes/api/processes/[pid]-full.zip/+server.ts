import { Process } from '@derzis/models';

import { PassThrough } from 'stream';
import { Readable } from 'stream';
import yazl from 'yazl';
import { type RequestEvent } from '@sveltejs/kit';

interface TripleReadable extends Readable {
  started?: boolean;
  first?: boolean;
}

function addInfo(zipfile: yazl.ZipFile, info: Awaited<ReturnType<typeof Process.prototype.getInfo>>) {
  const stats = JSON.stringify(info, null, 2);
  zipfile.addBuffer(Buffer.from(stats), 'info.json');
}

function addItems(
  zipfile: yazl.ZipFile,
  iter: AsyncGenerator<string, void, unknown>,
  filename: string
) {
  console.warn(`Adding ${filename} to zip...`);

  let started = false;
  let first = true;
  let reading = false; // prevents concurrent reads

  const stream = new Readable({
    read() {
      if (reading) return; // already in progress
      reading = true;

      (async () => {
        try {
          if (!started) {
            this.push('[\n'); // start array
            started = true;
          }

          const { value, done } = await iter.next();
          if (done) {
            this.push('\n]'); // close array
            this.push(null);  // end stream
            return;
          }

          const chunk = (first ? '  ' : ',\n  ') + value;
          first = false;
          this.push(chunk);
        } catch (err) {
          this.destroy(err as Error);
        } finally {
          reading = false;
        }
      })();
    }
  });

  zipfile.addReadStream(stream, filename);
}
export async function GET({ params }: RequestEvent) {
  const p = await Process.findOne({ pid: params.pid });
  if (!p) throw new Error('Not found');

  const zipfile = new yazl.ZipFile();

  // Add info.json
  addInfo(zipfile, await p.getInfo());

  // Add triples.json as a stream
  addItems(zipfile, p.getTriplesJson(), `${params.pid}-triples.json`);

  // Add resources.json as a stream
  addItems(zipfile, p.getResourcesJson(), `${params.pid}-resources.json`);

  // Add domains.json as a stream
  addItems(zipfile, p.getDomainsJson(), `${params.pid}-domains.json`);



  // Finalize zip and pipe to response
  const pass = new PassThrough();
  zipfile.outputStream.pipe(pass);
  zipfile.end();

  return new Response(pass as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${params.pid}-full.zip"`,
    },
  });
}
