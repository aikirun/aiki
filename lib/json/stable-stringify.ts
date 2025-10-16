/**
 * Stable JSON serialization that sorts object keys for deterministic hashing.
 * Ensures {a: 1, b: 2} and {b: 2, a: 1} produce the same hash.
 *
 * @param value - The value to serialize
 * @returns A stable JSON string representation
 *
 * @example
 * ```ts
 * const hash1 = await sha256(stableStringify({ b: 2, a: 1 }));
 * const hash2 = await sha256(stableStringify({ a: 1, b: 2 }));
 * assert(hash1 === hash2); // true - same hash despite different key order
 * ```
 */
export function stableStringify(value: unknown): string {
	if (value === null || value === undefined) {
		return JSON.stringify(value);
	}

	if (typeof value !== "object") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	const keys = Object.keys(value).sort();
	const pairs = keys.map((key) => {
		const val = (value as Record<string, unknown>)[key];
		return `${JSON.stringify(key)}:${stableStringify(val)}`;
	});
	return `{${pairs.join(",")}}`;
}
