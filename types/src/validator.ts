export class SchemaValidationError extends Error {
	public readonly issues: ReadonlyArray<Issue>;

	constructor(message: string, issues: ReadonlyArray<Issue>) {
		super(message);
		this.name = "SchemaValidationError";
		this.issues = issues;
	}
}

interface Issue {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
}

interface PathSegment {
	readonly key: PropertyKey;
}
