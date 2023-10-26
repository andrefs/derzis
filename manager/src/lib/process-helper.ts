import { Process, ProcessClass } from '@derzis/models';
import type { RecursivePartial } from '@derzis/common';

export async function newProcess(p: RecursivePartial<ProcessClass>) {
	const pathHeads: Map<string, number> = new Map();
	for (const s of p.seeds!) {
		const domain = new URL(s).origin;
		if (!pathHeads.get(domain)) {
			pathHeads.set(domain, 0);
		}
		pathHeads.set(domain, pathHeads.get(domain)! + 1);
	}

	p.pathHeads = Object.fromEntries(pathHeads.entries());

	const proc = await Process.create(p);

	await Process.startNext();
	return proc;
}
