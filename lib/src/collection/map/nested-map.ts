/**
 * Maps nested one level per key, in the order given, with the item at the leaf.
 * `NestedMap<Row, ["a", "b"]>` is `Map<Row["a"], Map<Row["b"], Row>>`.
 */
export type NestedMap<T, Keys extends readonly (keyof T)[]> = Keys extends readonly [
	infer First extends keyof T,
	...infer Rest extends readonly (keyof T)[],
]
	? Rest extends readonly [keyof T, ...(keyof T)[]]
		? Map<T[First], NestedMap<T, Rest>>
		: Map<T[First], T>
	: never;

/**
 * Indexes items by the given keys, one map level per key, with the item at the leaf.
 * Probing walks the same path: `nestedMap(rows, "a", "b").get(a)?.get(b)`.
 *
 * A later item with the same key path replaces the earlier one.
 */
export function nestedMap<T, const Keys extends readonly [keyof T, ...(keyof T)[]]>(
	items: Iterable<T>,
	...keys: Keys
): NestedMap<T, Keys> {
	const root = new Map<unknown, unknown>();
	const leafKeyIndex = keys.length - 1;
	// biome-ignore lint/style/noNonNullAssertion: the tuple type guarantees at least one key
	const leafKey = keys[leafKeyIndex]!;

	for (const item of items) {
		let level = root;
		for (let index = 0; index < leafKeyIndex; index++) {
			// biome-ignore lint/style/noNonNullAssertion: index stays below key length
			const key = keys[index]!;
			const value = item[key];
			let next = level.get(value) as Map<unknown, unknown> | undefined;
			if (next === undefined) {
				next = new Map();
				level.set(value, next);
			}
			level = next;
		}
		level.set(item[leafKey], item);
	}

	return root as unknown as NestedMap<T, Keys>;
}
