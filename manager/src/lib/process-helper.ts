import { StepClass, Process, ProcessClass, Resource, Triple, Path } from '@derzis/models';
import { type RecursivePartial, sendInitEmail } from '@derzis/common';
import { secondsToString, type MakeOptional } from './utils';
import { createLogger } from '@derzis/common';
const log = createLogger('process-helper');

export async function newProcess(p: RecursivePartial<ProcessClass>) {
	const pathHeads: Map<string, number> = new Map();
	for (const s of p.currentStep!.seeds!) {
		const domain = new URL(s).origin;
		if (!pathHeads.get(domain)) {
			pathHeads.set(domain, 0);
		}
		pathHeads.set(domain, pathHeads.get(domain)! + 1);
	}

	p.pathHeads = Object.fromEntries(pathHeads.entries());

	const proc = await Process.create(p);
	await proc.notifyProcessCreated();

	await Process.startNext();

	//if (proc.notification?.email) {
	//	await sendInitEmail(proc.notification.email, proc.pid);
	//}

	return proc;
}

export async function addStep(pid: string, params: MakeOptional<StepClass, 'seeds'>) {
	const p = await Process.findOne({ pid, status: 'done' });

	if (!p) {
		throw new Error('Process not found');
	}

	const oldSeeds = new Set(p.currentStep.seeds);
	const newSeeds = (params.seeds || []).filter((s) => !oldSeeds.has(s));

	const newMPL = Math.max(p.currentStep.maxPathLength, params.maxPathLength);
	const newMPP = Math.max(p.currentStep.maxPathProps, params.maxPathProps);

	console.log('XXXXXXXXXXXXXXX proc-helper 5', JSON.stringify({ params }, null, 2));
	const newStep = {
		seeds: [...oldSeeds, ...newSeeds],
		maxPathLength: newMPL,
		maxPathProps: newMPP,
		predLimit: params.predLimit,
		followDirection: params.followDirection as boolean,
		predsDirMetrics: params.predsDirMetrics
	};

	console.log('XXXXXXXXXXXXXXX proc-helper 6', JSON.stringify({ newStep }, null, 2));
	await Process.updateOne(
		{ pid, status: 'done' },
		{
			$push: { steps: newStep },
			$set: {
				currentStep: newStep,
				status: 'queued'
			}
		}
	);
	log.info(`Added step to process ${pid}`);

	if (newSeeds.length) {
		await Resource.insertSeeds(newSeeds, pid);
		log.info(`Inserted seeds for process ${pid}`);
	}
}

export async function info(pid: string) {
	const _p: ProcessClass | null = await Process.findOne({ pid }).lean();
	if (!_p) {
		return;
	}

	const lastResource = await Resource.findOne().sort({ updatedAt: -1 }); // TODO this should be process specific
	const lastTriple = await Triple.findOne().sort({ updatedAt: -1 });
	const lastPath = await Path.findOne().sort({ updatedAt: -1 });
	const last = Math.max(
		lastResource?.updatedAt.getTime() || 0,
		lastTriple?.updatedAt.getTime() || 0,
		lastPath?.updatedAt.getTime() || 0
	);

	const timeToLastResource = lastResource
		? (lastResource!.updatedAt.getTime() - _p.createdAt!.getTime()) / 1000
		: null;
	const timeRunning = last ? (last - _p.createdAt!.getTime()) / 1000 : null;
	const p = {
		..._p,
		createdAt: _p.createdAt?.toISOString(),
		updatedAt: _p.updatedAt?.toISOString() || _p.createdAt,
		timeToLastResource: timeToLastResource ? secondsToString(timeToLastResource) : '',
		timeRunning: timeRunning ? secondsToString(timeRunning) : '',
		notification: {
			..._p.notification,
			email: _p?.notification?.email
				?.replace(/(?<=.).*?(?=.@)/, (x) => '*'.repeat(x.length))
				?.replace(/^..(?=@)/, '**')
		}
	};

	return structuredClone(p);
}
