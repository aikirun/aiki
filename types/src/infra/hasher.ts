import type { Logger } from "@aikirun/lib/logger";

/**
 * A hasher may rotate: from then on it produces a different hash for the same input, while the
 * hashes it produced before stay stored. The optional fields carry the same input under other
 * rotations, so those stored hashes still match.
 */
export interface Hash {
	value: string;
	/** The hash under rotations this hasher has switched away from, whose stored hashes still match. */
	deprecatedValues?: string[];
	/**
	 * The hash under a rotation this hasher has been told about but has not switched to yet.
	 * Matched like `value`, never stored, so an instance that has not switched yet still finds what
	 * an instance that already has stored.
	 */
	nextValue?: string;
}

export interface HasherContext {
	logger: Logger;
}

export interface Hasher {
	(input: unknown): Promise<Hash>;
	/**
	 * This hasher under the rotation that produced `hash`, or null when it cannot hash under that
	 * rotation. A run is replayed with it, so every hash computed inside the run stays comparable
	 * with the run's record.
	 */
	for(hash: string): Promise<BoundHasher | null>;
}

export type BoundHasher = (input: unknown) => Promise<string>;

export type CreateHasher = (context: HasherContext) => Hasher;
