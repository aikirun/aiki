import type { NonArrayObject, PathFromObject, TypeOfValueAtPath } from "./types";

/**
 * Sets a value at a dot-notation path in an object.
 * Mutates the object in place.
 */
function set(obj: Record<string, unknown>, path: string, value: unknown): void {
	const keys = path.split(".");
	let currentValue: Record<string, unknown> = obj;

	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i] as string;
		let nextValue = currentValue[key];
		if (nextValue === undefined || nextValue === null) {
			nextValue = {};
			currentValue[key] = nextValue;
		}
		currentValue = nextValue as Record<string, unknown>;
	}

	const lastKey = keys[keys.length - 1] as string;
	currentValue[lastKey] = value;
}

interface OverrideEntry {
	path: string;
	value: unknown;
}

interface ObjectBuilder<T extends object> {
	with<Path extends PathFromObject<T>>(path: Path, value: TypeOfValueAtPath<T, Path>): ObjectBuilder<T>;
	build(): T;
}

/**
 * Creates a type-safe object overrider that allows setting deeply nested fields
 * with full autocomplete support.
 *
 * @example
 * ```typescript
 * const overrider = objectOverrider<TaskOptions>({ retry: { type: "never" } });
 * const result = overrider()
 *   .with("retry.type", "fixed")
 *   .with("retry.maxAttempts", 3)
 *   .build();
 * ```
 */
export const objectOverrider =
	<T extends object>(defaultObj: NonArrayObject<T>) =>
	(obj?: T): ObjectBuilder<T> => {
		const createBuilder = (overrides: OverrideEntry[]): ObjectBuilder<T> => ({
			with: <Path extends PathFromObject<T>>(path: Path, value: TypeOfValueAtPath<T, Path>) =>
				createBuilder([...overrides, { path: `${path}`, value }]),

			build: (): T => {
				const clonedObject = structuredClone(obj ?? defaultObj);
				for (const { path, value } of overrides) {
					set(clonedObject as Record<string, unknown>, path, value);
				}
				return clonedObject;
			},
		});
		return createBuilder([]);
	};
