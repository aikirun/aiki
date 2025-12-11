export class NotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NotFoundError";
	}
}

export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}

export class UnauthorizedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class ConflictError extends Error {
	constructor(
		message: string,
		public readonly currentRevision: number,
		public readonly expectedRevision: number
	) {
		super(message);
		this.name = "ConflictError";
	}
}
