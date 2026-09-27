import type { NonArrayObject, PathFromObject, TypeOfValueAtPath } from "./types";

/**
 * Sets a value at a dot-notation path in an object.
 * Mutates the object in place.
 *
 * The guards against __proto__/constructor/prototype segments prevent prototype
 * pollution.
 */
function set(obj: Record<string, unknown>, path: string, value: unknown): void {
	const keys = path.split(".");
	let currentValue: Record<string, unknown> = obj;

	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i] as string;
		if (key === "__proto__" || key === "constructor" || key === "prototype") {
			throw new Error(`Cannot set path "${path}": segment "${key}" is not allowed`);
		}
		let nextValue = currentValue[key];
		if (nextValue === undefined || nextValue === null) {
			nextValue = {};
			currentValue[key] = nextValue;
		}
		currentValue = nextValue as Record<string, unknown>;
	}

	const lastKey = keys[keys.length - 1] as string;
	if (lastKey === "__proto__" || lastKey === "constructor" || lastKey === "prototype") {
		throw new Error(`Cannot set path "${path}": segment "${lastKey}" is not allowed`);
	}
	currentValue[lastKey] = value;
}

interface OverrideEntry {
	path: string;
	value: unknown;
}

export interface ObjectBuilder<T extends object> {
	with<Path extends PathFromObject<T>>(path: Path, value: TypeOfValueAtPath<T, Path>): ObjectBuilder<T>;
	build(): T;
}

/**
 * Creates a type-safe object overrider that allows setting deeply nested fields
 * with full autocomplete support.
 *
 * Paths descend through plain nested objects and stop at union-typed fields —
 * a union is overridden whole.
 *
 * @example
 * ```typescript
 * interface TestConfig {
 *   name: string;
 *   limits: { maxWorkers: number; queueDepth: number };
 * }
 *
 * const overrider = objectOverrider<TestConfig>({
 *   name: "default",
 *   limits: { maxWorkers: 4, queueDepth: 100 }
 * });
 * const result = overrider()
 *   .with("limits.maxWorkers", 8)
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
