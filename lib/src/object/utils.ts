export function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined) continue;
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			result[key] = omitUndefined(value as Record<string, unknown>);
		} else {
			result[key] = value;
		}
	}
	return result;
}
