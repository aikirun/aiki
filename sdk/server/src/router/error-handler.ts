import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@aikirun/lib/error";
import { ORPCError } from "@orpc/server";

import {
	InvalidTaskStateTransitionError,
	InvalidWorkflowRunStateTransitionError,
	ScheduleConflictError,
	WorkflowRunConflictError,
	WorkflowRunRevisionConflictError,
} from "../errors";
import type { RequestContext } from "../middleware/context";

export function handleError<T extends RequestContext>(context: T, err: unknown) {
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

	if (err instanceof WorkflowRunRevisionConflictError) {
		throw new ORPCError("WORKFLOW_RUN_REVISION_CONFLICT", { message: err.message, status: 409 });
	}

	if (err instanceof WorkflowRunConflictError) {
		throw new ORPCError("WORKFLOW_RUN_CONFLICT", { message: err.message, status: 409 });
	}

	if (err instanceof ScheduleConflictError) {
		throw new ORPCError("SCHEDULE_CONFLICT", { message: err.message, status: 409 });
	}

	if (err instanceof InvalidWorkflowRunStateTransitionError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}

	if (err instanceof InvalidTaskStateTransitionError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}

	const cause = err instanceof Error && "cause" in err ? err.cause : undefined;
	context.logger.error("Request error occurred", {
		"aiki.errorName": err instanceof Error ? err.name : "Unknown",
		"aiki.errorMessage": err instanceof Error ? err.message : String(err),
		err,
		...(cause && typeof cause === "object" && "issues" in cause
			? { "aiki.validationIssues": (cause as { issues: unknown }).issues }
			: {}),
	});

	throw err;
}
