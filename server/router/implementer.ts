import { implement, ORPCError } from "@orpc/server";
import { publicContract } from "server/contract/public";

import { authedContract } from "../contract/authed";
import {
	InvalidWorkflowRunStateTransitionError,
	NotFoundError,
	RevisionConflictError,
	ScheduleConflictError,
	UnauthorizedError,
	ValidationError,
} from "../errors";
import type { Context } from "../middleware/context";

const basePublicImplementer = implement(publicContract).$context<Context>();
const baseAuthedImplementer = implement(authedContract).$context<Context>();

const withErrorHandler = baseAuthedImplementer.middleware(async ({ context, next }) => {
	try {
		return await next({ context });
	} catch (error) {
		if (context.type === "cron") {
			throw error;
		}

		if (error instanceof NotFoundError) {
			throw new ORPCError("NOT_FOUND", { message: error.message });
		}

		if (error instanceof ValidationError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}

		if (error instanceof UnauthorizedError) {
			throw new ORPCError("UNAUTHORIZED", { message: error.message });
		}

		if (error instanceof RevisionConflictError) {
			throw new ORPCError("CONFLICT", { message: error.message });
		}

		if (error instanceof ScheduleConflictError) {
			throw new ORPCError("CONFLICT", { message: error.message });
		}

		if (error instanceof InvalidWorkflowRunStateTransitionError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}

		context.logger.error(
			{
				errorName: error instanceof Error ? error.name : "Unknown",
				errorMessage: error instanceof Error ? error.message : String(error),
				error,
			},
			"Request error occurred"
		);

		throw error;
	}
});

export const publicImplementer = basePublicImplementer.use(withErrorHandler);
export const authedImplementer = baseAuthedImplementer.use(withErrorHandler);
