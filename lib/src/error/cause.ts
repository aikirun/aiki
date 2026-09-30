export function describeErrorCauses(err: Error): string[] {
	const descriptions: string[] = [];
	const described = new Set<unknown>([err]);
	let cause = err.cause;
	while (cause !== undefined && !described.has(cause)) {
		described.add(cause);
		if (cause instanceof Error) {
			descriptions.push(describeErrorCause(cause));
			cause = cause.cause;
		} else {
			descriptions.push(String(cause));
			cause = undefined;
		}
	}
	return descriptions;
}

function describeErrorCause(cause: Error): string {
	const code = "code" in cause && cause.code !== undefined ? ` [${String(cause.code)}]` : "";
	// An AggregateError may leave its message empty and keep its reasons in `errors`.
	const message =
		cause.message ||
		(cause instanceof AggregateError
			? cause.errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; ")
			: "");
	return `${cause.name}${code}: ${message}`;
}
