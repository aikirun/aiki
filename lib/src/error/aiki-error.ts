export abstract class AikiError extends Error {
	abstract readonly code: string;
	abstract readonly status: number;

	// biome-ignore lint/complexity/noUselessConstructor: makes the message required for every subclass
	constructor(message: string) {
		super(message);
	}
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
	override readonly name = "NotFoundError";
	readonly code = "NOT_FOUND";
	readonly status = 404;
}

export class ValidationError extends AikiError {
	override readonly name = "ValidationError";
	readonly code = "BAD_REQUEST";
	readonly status = 400;
}

export class UnauthorizedError extends AikiError {
	override readonly name = "UnauthorizedError";
	readonly code = "UNAUTHORIZED";
	readonly status = 401;
}

export class ForbiddenError extends AikiError {
	override readonly name = "ForbiddenError";
	readonly code = "FORBIDDEN";
	readonly status = 403;
}

export class ConflictError extends AikiError {
	override readonly name = "ConflictError";
	readonly code = "CONFLICT";
	readonly status = 409;
}
