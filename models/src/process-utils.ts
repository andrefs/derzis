export const matchesOne = (str: string, patterns: string[]) => {
	let matched = false;
	for (const p of patterns) {
		// pattern is a regex
		if (/^\/(.*)\/$/.test(p)) {
			const re = new RegExp(p);
			if (re.test(str)) {
				matched = true;
				break;
			}
			continue;
		}
		// pattern is a URL prefix
		try {
			const url = new URL(p);
			if (str.startsWith(p)) {
				matched = true;
				break;
			}
		} catch (e) {
			continue;
		}
		// pattern is a string
		if (str.includes(p)) {
			matched = true;
			break;
		}
	}
	return matched;
};