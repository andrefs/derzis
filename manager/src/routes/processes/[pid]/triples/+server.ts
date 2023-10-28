import { Process } from '@derzis/models';
import { error } from '@sveltejs/kit';
import { ReadableStream } from 'node:stream/web';

export async function GET({ params }) {
	const p = await Process.findOne({ pid: params.pid });
	if (!p) {
		throw error(404, {
			message: 'Not found'
		});
	}

	const iter = p?.getTriplesJson();

	const readable = ReadableStream.from(iter, { encoding: 'utf8' });

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
			'Content-Disposition': 'attachment; filename="triples.json.gz"'
		}
	});
}