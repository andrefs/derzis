import { Domain, Resource, Path, type DomainClass } from '@derzis/models';
import { type Action } from '@sveltejs/kit';

export async function load() {
  const domains: DomainClass[] = await Domain.find().lean();
  const _domains = domains.map((d) => ({
    ...d,
    lastAccessed: d.lastAccessed?.toISOString(),
    crawl: {
      ...d.crawl,
      nextAllowed: d.crawl.nextAllowed?.toISOString()
    },
    robots: d.robots
      ? {
          ...d.robots,
          checked: d.robots.checked?.toISOString()
        }
      : undefined
  }));

  return {
    domains: structuredClone(_domains)
  };
}

export const actions: { [name: string]: Action } = {
  resetErrors: async ({ request }) => {
    const data = await request.formData();
    const origin = data.get('origin') as string;

    await Resource.updateMany({ domain: origin, status: 'error' }, { status: 'unvisited' });

    await Path.updateMany(
      { 'head.domain.origin': origin, 'head.status': 'error' },
      { 'head.status': 'unvisited' }
    );

    return { success: true };
  }
};
