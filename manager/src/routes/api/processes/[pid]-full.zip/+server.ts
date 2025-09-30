import { Process } from '@derzis/models';

import { PassThrough } from 'stream';
import { Readable } from 'stream';
import yazl from 'yazl';
import { type RequestEvent } from '@sveltejs/kit';

interface TripleReadable extends Readable {
  started?: boolean;
  first?: boolean;
}

export async function GET({ params }: RequestEvent) {
  const p = await Process.findOne({ pid: params.pid });
  if (!p) throw new Error('Not found');

  // info.json
  const stats = JSON.stringify(await p.getInfo(), null, 2);


  const zipfile = new yazl.ZipFile();

  // Add info.json
  zipfile.addBuffer(Buffer.from(stats), 'info.json');

  // Add triples.json as a stream
  const triplesIter = p.getTriplesJson();

  const triplesStream = new Readable({
    async read(this: TripleReadable) {
      if (!this.started) {
        this.push('['); // start array
        this.started = true;
        this.first = true;
      }

      const { value, done } = await triplesIter.next();
      if (done) {
        this.push('\n]'); // close array
        this.push(null);
        return;
      }

      const chunk = (this.first ? '\n  ' : ',\n  ') + value;
      this.first = false;
      this.push(chunk);
    }
  });

  zipfile.addReadStream(triplesStream, `${params.pid}-triples.json`);

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
