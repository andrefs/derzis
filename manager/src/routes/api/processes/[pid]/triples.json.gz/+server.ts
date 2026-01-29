import { Process } from '@derzis/models';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from './$types';

export async function GET({ params, url }: RequestEvent) {
	const p = await Process.findOne({ pid: params.pid });
	if (!p) {
		throw error(404, {
			message: 'Not found'
		});
	}

	const includeCreatedAt = url.searchParams.get('includeCreatedAt') === 'true';
	const iter = p?.getTriplesJson(includeCreatedAt);

	//const readable = (ReadableStream as ReadableStreamExt).from(iter);
	const readable = new ReadableStream({
		async start(controller) {
			for await (const triple of iter) {
				controller.enqueue(triple);
			}
			controller.close();
		}
	});

	let i = 0;
	const transform = new TransformStream({
		start(controller) {
			controller.enqueue('[\n');
		},
		transform(triple, controller) {
			const res = i === 0 ? '  ' + triple : ',\n  ' + triple;
			i++;
			controller.enqueue(res);
		},
		flush(controller) {
			controller.enqueue('\n]');
		}
	});
	const compStream = new CompressionStream('gzip');

	readable.pipeThrough(transform).pipeTo(compStream.writable);
	return new Response(compStream.readable, {
		headers: {
			'Content-Type': 'application/gzip',
			'Content-Disposition': `attachment; filename="${params.pid}-triples.json.gz"`
		}
	});
}
