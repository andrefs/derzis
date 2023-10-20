import { Process, type ProcessClass } from '@derzis/models';

export async function load() {
	const ps: ProcessClass[] = await Process.find().lean();
	const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));

	return {
		processes: _ps
	};
}
