import type { PathFromObject, TypeOfValueAtPath } from "./types";

export function getByPath<T extends object, Path extends PathFromObject<T>>(
	obj: T,
	path: Path
): TypeOfValueAtPath<T, Path> {
	const keys = `${path}`.split(".");
	let current: unknown = obj;
	for (const key of keys) {
		if (current === null || current === undefined) {
			current = undefined;
			break;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current as TypeOfValueAtPath<T, Path>;
}

export function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined) {
			continue;
		}
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			result[key] = omitUndefined(value as Record<string, unknown>);
		} else {
			result[key] = value;
		}
	}
	return result;
}
