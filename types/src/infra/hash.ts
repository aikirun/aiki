import type { Logger } from "@aikirun/lib/logger";

export interface InputHash {
	value: string;
	/** Prior hashes that still identify this definition. */
	deprecatedValues?: string[];
}

export interface HasherContext {
	logger: Logger;
}

export interface Hasher {
	(input: unknown): Promise<InputHash>;
	for(hash: string): Promise<BoundHasher | null>;
}

export type BoundHasher = (input: unknown) => Promise<string>;

export type CreateHasher = (context: HasherContext) => Hasher;
