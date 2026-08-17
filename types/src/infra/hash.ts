export interface InputHash {
	value: string;
	/** Prior hashes that still identify this definition. */
	deprecatedValues?: string[];
}
