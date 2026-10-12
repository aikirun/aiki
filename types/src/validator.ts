export class SchemaValidationError extends Error {
	public override readonly name = "SchemaValidationError";
	public readonly issues: ReadonlyArray<Issue>;

	constructor(message: string, issues: ReadonlyArray<Issue>) {
		super(message);
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
