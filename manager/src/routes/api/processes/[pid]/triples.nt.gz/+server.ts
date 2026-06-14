import { createLogger } from '@derzis/common/server';
import { Process } from '@derzis/models';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { Readable, Transform } from 'stream';
import { StreamWriter, DataFactory } from 'n3';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import type { SimpleTriple } from '@derzis/common';
import { TripleType } from '@derzis/common';
const log = createLogger('api:processes:[pid]:triples');
const { literal, namedNode, quad } = DataFactory;

function simpleTripleToQuad(triple: SimpleTriple) {
  const s = namedNode(triple.subject);
  const p = namedNode(triple.predicate);

  if (triple.type === TripleType.NAMED_NODE) {
    return quad(s, p, namedNode(triple.object));
  }

  if (triple.type === TripleType.LITERAL) {
    const { value, language, datatype } = triple.object;
    if (language) {
      return quad(s, p, literal(value, language));
    }
    if (datatype) {
      return quad(s, p, literal(value, namedNode(datatype)));
    }
    return quad(s, p, literal(value));
  }

  return null;
}

export async function GET({ params, setHeaders }: RequestEvent) {
  const p = await Process.findOne({ pid: params.pid });
  if (!p) {
    throw error(404, {
      message: 'Not found'
    });
  }

  const iter = p?.getTriples();
  console.log('Iterating triples for process', params.pid);

  const sourceStream = Readable.from(iter, { objectMode: true });

  const toQuadTransform = new Transform({
    writableObjectMode: true,
    readableObjectMode: true,
    transform(triple: SimpleTriple, encoding, callback) {
      try {
        const q = simpleTripleToQuad(triple);
        if (q) {
          callback(null, q);
        } else {
          callback();
        }
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });

  const streamWriter = new StreamWriter({ format: 'N-Triples' });
  const gzipStream = createGzip();

  setHeaders({
    'Content-Disposition': `attachment; filename="${params.pid}-triples.nt.gz"`
  });

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          await pipeline(
            sourceStream,
            toQuadTransform,
            streamWriter,
            gzipStream,
            async function* (source) {
              for await (const chunk of source) {
                controller.enqueue(chunk);
              }
              controller.close();
            }
          );
        } catch (err) {
          controller.error(err);
        }
      }
    })
  );
}
