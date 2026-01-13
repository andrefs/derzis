export const secondsToString = (seconds: number) => {
	const numYears = Math.floor(seconds / 31536000);
	const numDays = Math.floor((seconds % 31536000) / 86400);
	const numHours = Math.floor(((seconds % 31536000) % 86400) / 3600);
	const numMinutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
	const numSeconds = Math.round((((seconds % 31536000) % 86400) % 3600) % 60);

	const res = [];
	if (numYears) {
		res.push(numYears > 1 ? `${numYears} years` : `1 year`);
	}
	if (numDays) {
		res.push(numDays > 1 ? `${numDays} days` : `1 day`);
	}
	if (numHours) {
		res.push(numHours > 1 ? `${numHours} hours` : `1 hour`);
	}
	if (numMinutes) {
		res.push(numMinutes > 1 ? `${numMinutes} minutes` : `1 minute`);
	}
	if (numSeconds) {
		res.push(numSeconds > 1 ? `${numSeconds} seconds` : `1 second`);
	}
	return res.join(' ');
};

export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] };

// Generate consistent colors for predicates
const predicateColors = new Map<string, string>();
export function getPredicateColor(predicate: string): string {
	const colors = [
		'#FF6B6B',
		'#4ECDC4',
		'#45B7D1',
		'#96CEB4',
		'#FFEAA7',
		'#DDA0DD',
		'#98D8C8',
		'#F7DC6F',
		'#BB8FCE',
		'#85C1E9'
	];
	if (!predicateColors.has(predicate)) {
		const index = predicateColors.size % colors.length;
		predicateColors.set(predicate, colors[index]);
	}
	return predicateColors.get(predicate)!;
}

export function isPredicateSelected(predicate: string, selectedPredicate: string): boolean {
	return selectedPredicate === 'all' || predicate === selectedPredicate;
}

export function formatDateLabel(date: Date): { date: string; time: string } {
	const day = date.getDate().toString().padStart(2, '0');
	const month = (date.getMonth() + 1).toString().padStart(2, '0');
	const year = date.getFullYear();
	const hour = date.getHours().toString().padStart(2, '0');
	const min = date.getMinutes().toString().padStart(2, '0');
	return {
		date: `${day}-${month}-${year}`,
		time: `${hour}:${min}`
	};
}
