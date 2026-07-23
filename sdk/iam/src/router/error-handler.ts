import type { ContextBase } from "@aikirun/lib/context";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@aikirun/lib/error";
import { ORPCError } from "@orpc/server";

export function handleError<T extends ContextBase>({ logger }: T, err: unknown) {
	if (err instanceof NotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}

	if (err instanceof ValidationError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}

	if (err instanceof UnauthorizedError) {
		throw new ORPCError("UNAUTHORIZED", { message: err.message });
	}

	if (err instanceof ForbiddenError) {
		throw new ORPCError("FORBIDDEN", { message: err.message, status: 403 });
	}

	if (err instanceof ConflictError) {
		throw new ORPCError("CONFLICT", { message: err.message, status: 409 });
	}

	const cause = err instanceof Error && "cause" in err ? err.cause : undefined;
	logger.error("Request error occurred", {
		err,
		...(cause && typeof cause === "object" && "issues" in cause
			? { "aiki.validationIssues": (cause as { issues: unknown }).issues }
			: {}),
	});

	throw err;
}
