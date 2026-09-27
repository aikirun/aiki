import type { DeepPartial, NonArrayObject } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValues(defaults: unknown, overrides: unknown): unknown {
	if (overrides === undefined) {
		return defaults;
	}
	if (!isPlainObject(defaults) || !isPlainObject(overrides)) {
		return overrides;
	}

	const result: Record<string, unknown> = { ...defaults };
	for (const key of Object.keys(overrides)) {
		if (key === "__proto__") {
			continue;
		}
		const overrideValue = overrides[key];
		if (overrideValue === undefined) {
			continue;
		}
		result[key] = mergeValues(defaults[key], overrideValue);
	}
	return result;
}

/**
 * Deep-merges `overrides` onto `defaults`, returning a full value. Nested plain
 * objects merge recursively; arrays and primitives in `overrides` replace the
 * default wholesale. `defaults` is never mutated.
 */
export function merge<T>(defaults: NonArrayObject<T>, overrides?: DeepPartial<NonArrayObject<T>>): T {
	return mergeValues(defaults, overrides) as T;
}
