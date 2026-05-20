import { Process, TraversalPath, EndpointPath, genEstimatePathQuery } from '@derzis/models';
import { PathType } from '@derzis/common';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
const log = createLogger('API');

interface EstimatePathsReqBody {
  ok: boolean;
  data: {
    maxPathLength: number;
    maxPathProps: number;
    predLimitations: {
      predicate: string;
      lims: string[];
    }[];
    followDirection?: boolean;
    convertToEndpointPaths?: boolean;
  };
}

export const POST: RequestHandler = async ({ request, params }) => {
  const resp = (await request.json()) as EstimatePathsReqBody;
  if (!params.pid) {
    log.warn('No process ID provided for path estimation');
    return json({ ok: false, err: { message: 'No process ID provided' } }, { status: 400 });
  }

  const proc = await Process.findOne({ pid: params.pid }).lean();
  if (!proc) {
    log.warn(`Process ${params.pid} not found for path estimation`);
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }

  const { maxPathLength, maxPathProps, predLimitations, convertToEndpointPaths } = resp.data;

  let pathType: PathType;
  if (convertToEndpointPaths) {
    pathType = PathType.ENDPOINT;
  } else {
    pathType = proc.curPathType ?? PathType.ENDPOINT;
  }

  const query = genEstimatePathQuery(
    params.pid,
    pathType,
    maxPathLength,
    maxPathProps,
    predLimitations || []
  );

  let estimatedPaths: number;
  if (pathType === PathType.TRAVERSAL) {
    estimatedPaths = await TraversalPath.countDocuments(query as any);
  } else {
    estimatedPaths = await EndpointPath.countDocuments(query as any);
  }

  log.info(
    `Path estimation for process ${params.pid}: ${estimatedPaths} paths ` +
      `(pathType=${pathType}, maxLength=${maxPathLength}, maxProps=${maxPathProps}, ` +
      `limitations=${predLimitations?.length || 0})`
  );

  return json({ ok: true, data: { estimatedPaths } });
};
