import { error } from '@sveltejs/kit';
import { secondsToString } from '$lib/utils';
import { Process, ProcessClass, Resource } from '@derzis/models';
import type { RequestEvent } from './$types';

export async function load({ params }: RequestEvent) {
  const _p: ProcessClass | null = await Process.findOne({ pid: params.pid }).lean();
  if (!_p) {
    throw error(404, {
      message: 'Not found'
    });
  }

  const lastResource = await Resource.findOne().sort({ updatedAt: -1 });
  const timeRunning = lastResource
    ? (lastResource!.updatedAt.getTime() - _p.createdAt!.getTime()) / 1000
    : null;
  const p = {
    ..._p,
    createdAt: _p.createdAt?.toISOString(),
    updatedAt: _p.updatedAt?.toISOString() || _p.createdAt,
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
