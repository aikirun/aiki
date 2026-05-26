import type { ContextBase } from "@aikirun/lib/context";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@aikirun/lib/error";
import { ORPCError } from "@orpc/server";

export function handleError<T extends ContextBase>(context: T, error: unknown) {
	if (error instanceof NotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}

	if (error instanceof ValidationError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}

	if (error instanceof UnauthorizedError) {
		throw new ORPCError("UNAUTHORIZED", { message: error.message });
	}

	if (error instanceof ForbiddenError) {
		throw new ORPCError("FORBIDDEN", { message: error.message, status: 403 });
	}

	if (error instanceof ConflictError) {
		throw new ORPCError("CONFLICT", { message: error.message, status: 409 });
	}

	const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
	context.logger.error("Request error occurred", {
		errorName: error instanceof Error ? error.name : "Unknown",
		errorMessage: error instanceof Error ? error.message : String(error),
		error,
		...(cause && typeof cause === "object" && "issues" in cause
			? { validationIssues: (cause as { issues: unknown }).issues }
			: {}),
	});

	throw error;
}
