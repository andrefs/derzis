import { Domain, type DomainClass } from '@derzis/models';

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
