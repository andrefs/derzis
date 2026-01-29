import { json } from '@sveltejs/kit';
import { Process } from '@derzis/models';

export async function GET() {
	const queued = await Process.find({ status: 'queued' }).countDocuments();
	const running = await Process.find({ status: 'running' }).countDocuments();
	const done = await Process.find({ status: 'done' }).countDocuments();
	const error = await Process.find({ status: 'error' }).countDocuments();

	return json({ processes: { queued, running, done, error } });
}
