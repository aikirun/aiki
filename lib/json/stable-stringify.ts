/**
 * Stable JSON serialization that sorts object keys for deterministic hashing.
 * Ensures {a: 1, b: 2} and {b: 2, a: 1} produce the same hash.
 *
 * @param value - The record to serialize
 * @returns A stable JSON string representation
 *
 * @example
 * ```ts
 * const hash1 = await sha256(stableStringify({ b: 2, a: 1 }));
 * const hash2 = await sha256(stableStringify({ a: 1, b: 2 }));
 * assert(hash1 === hash2); // true - same hash despite different key order
 * ```
 */
export function stableStringify(value: Record<string, unknown>): string {
	return stringifyValue(value);
}

function stringifyValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}

	if (typeof value !== "object") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map(stringifyValue).join(",")}]`;
	}

	const keys = Object.keys(value).sort();
	const pairs: string[] = [];
	for (const key of keys) {
		const keyValue = (value as Record<string, unknown>)[key];
		if (keyValue !== undefined) {
			pairs.push(`${JSON.stringify(key)}:${stringifyValue(keyValue)}`);
		}
	}
	return `{${pairs.join(",")}}`;
}
