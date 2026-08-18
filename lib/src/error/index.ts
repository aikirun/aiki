export abstract class AikiError extends Error {
	abstract readonly code: string;
	abstract readonly status: number;
}

export function asAikiError(err: unknown): AikiError | undefined {
	if (
		err instanceof Error &&
		"code" in err &&
		typeof err.code === "string" &&
		"status" in err &&
		typeof err.status === "number"
	) {
		return err as AikiError;
	}
	return undefined;
}

export class NotFoundError extends AikiError {
	readonly code = "NOT_FOUND";
	readonly status = 404;

	constructor(message: string) {
		super(message);
		this.name = "NotFoundError";
	}
}

export class ValidationError extends AikiError {
	readonly code = "BAD_REQUEST";
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}

export class UnauthorizedError extends AikiError {
	readonly code = "UNAUTHORIZED";
	readonly status = 401;

	constructor(message: string) {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class ForbiddenError extends AikiError {
	readonly code = "FORBIDDEN";
	readonly status = 403;

	constructor(message: string) {
		super(message);
		this.name = "ForbiddenError";
	}
}

export class ConflictError extends AikiError {
	readonly code = "CONFLICT";
	readonly status = 409;

	constructor(message: string) {
		super(message);
		this.name = "ConflictError";
	}
}
