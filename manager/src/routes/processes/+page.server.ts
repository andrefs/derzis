import { Process, type ProcessDocument } from '@derzis/models';

export async function load() {
	const processes: ProcessDocument[] = await Process.find().select('maxPathLength').lean();
	return { processes };
}
