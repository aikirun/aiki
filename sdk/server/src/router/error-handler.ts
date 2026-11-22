import type { RequestContextBase } from "@aikirun/lib/context";
import { asAikiError } from "@aikirun/lib/error";
import { ORPCError, ValidationError } from "@orpc/server";

export function handleError<T extends RequestContextBase>({ logger }: T, err: unknown): never {
	if (err instanceof ORPCError && err.code === "BAD_REQUEST" && err.cause instanceof ValidationError) {
		const problems = err.cause.issues.map((issue) => issue.message).join("; ");
		throw new ORPCError("BAD_REQUEST", { message: `Input validation failed: ${problems}`, status: 400 });
	}

	const aikiError = asAikiError(err);
	if (aikiError) {
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
