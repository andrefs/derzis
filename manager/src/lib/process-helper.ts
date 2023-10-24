import { Process, ProcessClass } from '@derzis/models';
import type { RecursivePartial } from '@derzis/common';

export async function newProcess(p: RecursivePartial<ProcessClass>) {
	const proc = await Process.create(p);
	await Process.startNext();
	return proc;
}
