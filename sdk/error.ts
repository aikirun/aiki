import type { SerializableError } from "@aiki/types/serializable";

export function createSerializableError(error: unknown): SerializableError {
	return error instanceof Error
		? {
			message: error.message,
			name: error.name,
			stack: error.stack,
			cause: error.cause ? createSerializableError(error.cause) : undefined,
		}
		: {
			message: String(error),
			name: "UnknownError",
		};
}

export function isServerConflictError(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "CONFLICT"
	);
}
