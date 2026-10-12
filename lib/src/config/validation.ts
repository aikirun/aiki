export type ConfigValidationResult = { valid: true } | { valid: false; reason: string };

/** Rejects a config in which a setting is NaN, naming one such setting. */
export function validateNoNaN(config: unknown): ConfigValidationResult {
	const nanPath = findNaNPath(config);
	if (nanPath !== undefined) {
		return { valid: false, reason: `${nanPath} is NaN` };
	}
	return { valid: true };
}

function findNaNPath(config: unknown): string | undefined {
	const visited = new Set<object>();
	const pending = [{ value: config, path: "" }];

	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		const { value, path } = next;
		if (typeof value === "number" && Number.isNaN(value)) {
			return path;
		}
		if (typeof value !== "object" || value === null || visited.has(value)) {
			continue;
		}

		visited.add(value);
		for (const [key, child] of Object.entries(value)) {
			pending.push({ value: child, path: path === "" ? key : `${path}.${key}` });
		}
	}
	return undefined;
}
