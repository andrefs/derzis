import { StepClass, Process, ProcessClass, Resource } from '@derzis/models';
import type { RecursivePartial } from '@derzis/common';

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

	await Process.startNext();
	return proc;
}

export async function addStep(pid: string, params: StepClass) {
	const p = await Process.findOne({ pid, status: 'done' });

	if (!p) {
		throw new Error('Process not found');
	}

	const oldSeeds = new Set(p.currentStep.seeds);
	const newSeeds = params.seeds.filter((s) => !oldSeeds.has(s));

	const newMPL = Math.max(p.currentStep.maxPathLength, params.maxPathLength);
	const newMPP = Math.max(p.currentStep.maxPathProps, params.maxPathProps);

	const newStep = {
		seeds: [...oldSeeds, ...newSeeds],
		maxPathLength: newMPL,
		maxPathProps: newMPP,
		whiteList: params.whiteList,
		blackList: params.blackList
	};

	await Process.updateOne(
		{ pid, status: 'done' },
		{
			$push: { steps: newStep },
			$set: { currentStep: newStep },
			status: 'queued'
		}
	);

	await Resource.insertSeeds(newSeeds, pid);
}
