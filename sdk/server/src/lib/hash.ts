import { asNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Hash } from "@aikirun/types/infra/hasher";

export interface CandidateHashes {
	current: string;
	/** Every value a stored hash may equal to count as the hash: the current, the deprecated, and the next. */
	all: NonEmptyArray<string>;
}

/** The hash's next values, with the deprecated single `nextValue` counted as one more. */
export function nextHashes(hash: Hash): string[] {
	const nextValues = hash.nextValues ?? [];
	return hash.nextValue === undefined ? nextValues : nextValues.concat(hash.nextValue);
}

export function candidateHashes(hash: Hash): CandidateHashes {
	const candidates = [hash.value].concat(hash.deprecatedValues ?? [], nextHashes(hash));
	return { current: hash.value, all: asNonEmptyArray(Array.from(new Set(candidates))) };
}
