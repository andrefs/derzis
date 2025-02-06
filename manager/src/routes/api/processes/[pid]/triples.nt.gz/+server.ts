import { Process } from '@derzis/models';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { StreamWriter, Writer } from 'n3';

export async function GET({ params }: RequestEvent) {
	const p = await Process.findOne({ pid: params.pid });
	if (!p) {
		throw error(404, {
			message: 'Not found'
		});
	}

	const iter = p?.getTriples();
	const compStream = new CompressionStream('gzip');
	const writer = new Writer(compStream, { format: 'N-Triples' });

	for await (const t of iter) {
		writer.addQuad(t.subject, t.predicate, t.object);
	}

	return new Response(compStream.readable, {
		headers: {
			'Content-Type': 'application/gzip',
			'Content-Disposition': 'attachment; filename="triples.json.gz"'
		}
	});
}
