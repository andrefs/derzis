import { createLogger } from '@derzis/common/server';
import { Process } from '@derzis/models';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { Readable } from 'stream';
import { Writer, NamedNode, Literal } from 'n3';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import type { SimpleTriple } from '@derzis/common';
const log = createLogger('api:processes:[pid]:triples');

export async function GET({ params, setHeaders }: RequestEvent) {
  const p = await Process.findOne({ pid: params.pid });
  if (!p) {
    throw error(404, {
      message: 'Not found'
    });
  }

  const iter = p?.getTriples();
  console.log('Iterating triples for process', params.pid);

  const readableStream = Readable.from(iter, { objectMode: true });

  const writer = new Writer({ format: 'N-Triples' });

  const transformStream = new Readable({
    objectMode: true,
    read() { }
  });

  readableStream.on('data', (quad: SimpleTriple) => {
    console.log('Processing quad:', quad);
    if (quad.type === 'namedNode') {
      writer.addQuad(
        new NamedNode(quad.subject),
        new NamedNode(quad.predicate),
        new NamedNode(quad.object)
      );
    } else if (quad.type === 'literal') {
      const { value, language, datatype } = quad.object;
      const LiteralConstructor = Literal as new (value: string, languageOrDatatype?: string | import('n3').NamedNode) => import('n3').Literal;
      if (language) {
        writer.addQuad(
          new NamedNode(quad.subject),
          new NamedNode(quad.predicate),
          new LiteralConstructor(value, language)
        );
      } else if (datatype) {
        writer.addQuad(
          new NamedNode(quad.subject),
          new NamedNode(quad.predicate),
          new LiteralConstructor(value, new NamedNode(datatype))
        );
      } else {
        writer.addQuad(
          new NamedNode(quad.subject),
          new NamedNode(quad.predicate),
          new LiteralConstructor(value)
        );
      }
    } else {
      // Handle other types if necessary
      log.warn(`Unknown quad type: ${quad}`);
    }
  });

  readableStream.on('end', () => {
    writer.end((err, result) => {
      if (err) transformStream.destroy(err);
      else {
        transformStream.push(result);
        transformStream.push(null);
      }
    });
  });

  const gzipStream = createGzip();

  setHeaders({
    'Content-Disposition': `attachment; filename="${params.pid}-triples.nt.gz"`
  });

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          await pipeline(transformStream, gzipStream, async function* (source) {
            for await (const chunk of source) {
              controller.enqueue(chunk);
            }
            controller.close();
          });
        } catch (err) {
          controller.error(err);
        }
      }
    })
  );
}
