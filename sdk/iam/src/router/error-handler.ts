import type { ContextBase } from "@aikirun/lib/context";
import { asAikiError } from "@aikirun/lib/error";
import { ORPCError, ValidationError } from "@orpc/server";

export function handleError<T extends ContextBase>({ logger }: T, err: unknown): never {
	if (err instanceof ORPCError && err.code === "BAD_REQUEST" && err.cause instanceof ValidationError) {
		const problems = err.cause.issues.map((issue) => issue.message).join("; ");
		throw new ORPCError("BAD_REQUEST", { message: `Input validation failed: ${problems}`, status: 400 });
	}

	if (err instanceof ORPCError && err.cause instanceof ValidationError) {
		const problems = err.cause.issues.map((issue) => issue.message).join("; ");
		logger.error("Output validation failed", {
			err,
			"aiki.validationIssues": err.cause.issues,
		});
		throw new ORPCError(err.code, { message: `Output validation failed: ${problems}`, status: err.status });
	}

	const aikiError = asAikiError(err);
	if (aikiError) {
		if (aikiError.status >= 500) {
			logger.error("Request error occurred", { err });
		}
		throw new ORPCError(aikiError.code, { message: aikiError.message, status: aikiError.status });
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
