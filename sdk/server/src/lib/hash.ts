import type { Hash } from "@aikirun/types/infra/hasher";

/** Every value a stored hash may equal to count as `hash`: the current, the deprecated, and the next. */
export function candidateHashes(hash: Hash): string[] {
	const candidates = [hash.value].concat(hash.deprecatedValues ?? []);
	if (hash.nextValue !== undefined) {
		candidates.push(hash.nextValue);
	}
	return Array.from(new Set(candidates));
}
