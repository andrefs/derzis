import { StepClass, Process, ProcessClass, Resource, Triple, Path } from '@derzis/models';
import { type RecursivePartial } from '@derzis/common';
import { sendInitEmail } from '@derzis/common/server';
import { secondsToString, type MakeOptional } from './utils';
import { createLogger } from '@derzis/common/server';
const log = createLogger('process-helper');

/**
 * Create a new process and queue it for execution.
 * @param p Process parameters
 */
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

	return proc;
}

/**
 * Add a new step to a finished process and queue it for execution.
 * @param pid Process ID
 * @param params Step parameters
 */
export async function addStep(pid: string, params: MakeOptional<StepClass, 'seeds'>) {
	const p = await Process.findOne({ pid, status: 'done' });

	if (!p) {
		throw new Error('Process not found');
	}

	if (params.resetErrors) {
		log.info(`Resetting errored states for process ${pid}`);
		const res = await p.resetErroredStates();
		log.debug(`Reset errored states for process ${pid}: ${res}`);
	}

	const oldSeeds = new Set(p.currentStep.seeds);
	const newSeeds = (params.seeds || []).filter((s) => !oldSeeds.has(s));
	const newMPL = Math.max(p.currentStep.maxPathLength, params.maxPathLength);
	const newMPP = Math.max(p.currentStep.maxPathProps, params.maxPathProps);

	const newStep = {
		seeds: [...oldSeeds, ...newSeeds],
		maxPathLength: newMPL,
		maxPathProps: newMPP,
		predLimit: params.predLimit,
		followDirection: params.followDirection as boolean,
		predsDirMetrics: params.predsDirMetrics
	};

	try {
		// Insert new seeds
		if (newSeeds.length) {
			await Resource.insertSeeds(newSeeds, pid);
			log.info(`Inserted seeds for process ${pid}`);
		}

		// Add the new step
		await Process.updateOne(
			{ pid, status: 'done' },
			{
				$push: { steps: newStep },
				$set: {
					currentStep: newStep,
				}
			}
		);
		log.info(`Added step to process ${pid}`);

		// Before queuing, extend existing paths according to new step limits
		await p.extendExistingPaths();

		// Set the process to queued
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
		log.info(`Queued process ${pid} for next step`);
	} catch (err) {
		log.error(`Error adding step to process ${pid}: ${(err as Error).message}`);
		throw err;
	}
}

/**
 * Get detailed info about a process.
 * @param pid Process ID
 */
export async function info(pid: string) {
	const _p: ProcessClass | null = await Process.findOne({ pid }).lean();
	if (!_p) {
		return;
	}

	const lastResource = await Resource.findOne().sort({ updatedAt: -1 }); // TODO this should be process specific
	const lastTriple = await Triple.findOne().sort({ updatedAt: -1 });
	const lastPath = await Path.findOne({ status: 'active' }).sort({ updatedAt: -1 });
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
