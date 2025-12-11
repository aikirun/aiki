import { implement, ORPCError } from "@orpc/server";
import { contract } from "../contract/index";
import type { ServerContext } from "../middleware/context";
import { NotFoundError, ValidationError, UnauthorizedError, ConflictError } from "../errors";

const base = implement(contract).$context<ServerContext>();

const withErrorHandler = base.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		context.logger.error(
			{
				errorName: error instanceof Error ? error.name : "Unknown",
				errorMessage: error instanceof Error ? error.message : String(error),
				error,
			},
			"Request error occurred"
		);

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

export const baseImplementer = base.use(withErrorHandler);
