import { asNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Hash } from "@aikirun/types/infra/hasher";

export interface CandidateHashes {
	current: string;
	/** Every value a stored hash may equal to count as the hash: the current, the deprecated, and the next. */
	all: NonEmptyArray<string>;
}

export function candidateHashes(hash: Hash): CandidateHashes {
	const candidates = [hash.value].concat(hash.deprecatedValues ?? []);
	if (hash.nextValue !== undefined) {
		candidates.push(hash.nextValue);
	}
	return { current: hash.value, all: asNonEmptyArray(Array.from(new Set(candidates))) };
}
