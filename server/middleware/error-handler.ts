import { ORPCError, os } from "@orpc/server";

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

export const withErrorHandler = os.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		// deno-lint-ignore no-console
		console.log(error);

		if (error instanceof NotFoundError) {
			throw new ORPCError("NOT_FOUND", { message: error.message });
		}

		if (error instanceof ValidationError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}

		if (error instanceof UnauthorizedError) {
			throw new ORPCError("UNAUTHORIZED", { message: error.message });
		}

		if (error instanceof ConflictError) {
			throw new ORPCError("CONFLICT", { message: error.message });
		}

		throw error;
	}
});
