/**
 * Stable JSON serialization that sorts object keys for deterministic hashing.
 * Ensures {a: 1, b: 2} and {b: 2, a: 1} produce the same hash.
 *
 * Throws for values JSON would change silently (Date, Map, Set, class instances),
 * so two different values never appear equal.
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

// Most keys and values are short, and scanning a short string here is cheaper than a native
// call. A string that is long, or that holds anything JSON escapes, goes to JSON.stringify.
const STRING_SCAN_LIMIT = 32;

function quote(text: string): string {
	if (text.length > STRING_SCAN_LIMIT) {
		return JSON.stringify(text);
	}
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 32 || code === 34 || code === 92 || (code >= 0xd800 && code <= 0xdfff)) {
			return JSON.stringify(text);
		}
	}
	return `"${text}"`;
}

function stringifyValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}

	if (typeof value === "string") {
		return quote(value);
	}

	if (typeof value === "number") {
		return Number.isFinite(value) ? String(value) : "null";
	}

	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}

	if (typeof value === "function") {
		throw new Error("stableStringify does not support function values");
	}

	if (typeof value === "symbol") {
		throw new Error("stableStringify does not support symbol values");
	}

	if (typeof value !== "object") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		let out = "[";
		for (let index = 0; index < value.length; index++) {
			if (index > 0) {
				out += ",";
			}
			out += stringifyValue(value[index]);
		}
		return `${out}]`;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`stableStringify does not support ${typeName(value)} values`);
	}

	const keys = Object.keys(value);
	if (keys.length > 1) {
		keys.sort();
	}
	let out = "{";
	let first = true;
	for (const key of keys) {
		const keyValue = (value as Record<string, unknown>)[key];
		if (keyValue === undefined) {
			continue;
		}
		if (!first) {
			out += ",";
		}
		first = false;
		out += `${quote(key)}:${stringifyValue(keyValue)}`;
	}
	return `${out}}`;
}

function typeName(value: object): string {
	const constructorName = typeof value.constructor === "function" ? value.constructor.name : "";
	return constructorName === "" ? "object" : constructorName;
}
