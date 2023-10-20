import { Process, type ProcessClass } from '@derzis/models';
import { json } from '@sveltejs/kit';

export async function GET({ url }) {
	const ps: ProcessClass[] = await Process.find().lean();
	const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));

	return json({ processes: _ps });
}

export async function POST({ request }) {
	const { process } = await request.json();
	const proc = await newProcess(process);

	return json(proc);
}
