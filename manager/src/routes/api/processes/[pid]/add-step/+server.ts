import { addStep } from '$lib/process-helper';
import { PredDirMetrics, Process, StepClass, type PredicateLimitationType } from '@derzis/models';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import type { MakeOptional } from '$lib/utils';
const log = createLogger('API');

interface NewStepReqBody {
  ok: boolean;
  data: {
    newSeeds: string[];
    maxPathLength: number;
    maxPathProps: number;
    predLimitations: {
      predicate: string;
      lims: PredicateLimitationType[];
    }[];
    followDirection: boolean;
    predsDirMetrics?: PredDirMetrics[];
    resetErrors: boolean;
    convertToEndpointPaths: boolean;
  };
}

function validatePredLimitations(
  predLimitations: NewStepReqBody['data']['predLimitations']
): string[] {
  const errors: string[] = [];
  const predMap = new Map<string, PredicateLimitationType[]>();

  for (const pl of predLimitations) {
    const existing = predMap.get(pl.predicate) || [];
    predMap.set(pl.predicate, [...existing, ...pl.lims]);
  }

  for (const [predicate, lims] of predMap) {
    if (lims.includes('require-past') && lims.includes('disallow-past')) {
      errors.push(
        `Contradiction for predicate '${predicate}': cannot have both require-past and disallow-past`
      );
    }
    if (lims.includes('require-future') && lims.includes('disallow-future')) {
      errors.push(
        `Contradiction for predicate '${predicate}': cannot have both require-future and disallow-future`
      );
    }
  }

  return errors;
}

export const POST: RequestHandler = async ({ request, params }) => {
  const resp = (await request.json()) as NewStepReqBody;
  if (!params.pid) {
    log.warn('No process ID provided');
    return json({ ok: false, err: { message: 'No process ID provided' } }, { status: 400 });
  }

  console.log('XXXXXXXXXXXXXXX add-step server 3', JSON.stringify(resp.data, null, 2));

  const predLimitations = resp.data.predLimitations || [];

  // Validate for contradictions
  if (predLimitations.length > 0) {
    const validationErrors = validatePredLimitations(predLimitations);
    if (validationErrors.length > 0) {
      return json({ ok: false, err: { message: validationErrors.join('; ') } }, { status: 400 });
    }
  }

  const procParams: MakeOptional<StepClass, 'seeds'> = {
    seeds: resp.data.newSeeds,
    maxPathLength: resp.data.maxPathLength,
    maxPathProps: resp.data.maxPathProps,
    predLimitations: predLimitations,
    followDirection: resp.data.followDirection,
    predsDirMetrics: resp.data.predsDirMetrics,
    resetErrors: resp.data.resetErrors,
    convertToEndpointPaths: resp.data.convertToEndpointPaths
  };

  const proc = await Process.findOne({ pid: params.pid });
  if (!proc) {
    log.warn(`Process ${params.pid} not found`);
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }
  if (proc.status !== 'done') {
    log.warn(`Process ${params.pid} is still running, cannot add another step`);
    return json(
      { ok: false, err: { message: 'Process still running, cannot add another step' } },
      { status: 400 }
    );
  }

  await addStep(params!.pid!, procParams);
  log.info(`Added step to process ${params.pid}`);

  return json({ ok: true }, { status: 201 });
};
