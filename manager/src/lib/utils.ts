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
