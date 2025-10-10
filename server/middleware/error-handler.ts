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

export const withErrorHandler = os.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		if (error instanceof NotFoundError) {
			throw new ORPCError("NOT_FOUND", { message: error.message });
		}

		if (error instanceof ValidationError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}

		if (error instanceof UnauthorizedError) {
			throw new ORPCError("UNAUTHORIZED", { message: error.message });
		}

		throw error;
	}
});
