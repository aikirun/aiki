import type { SerializableError } from "@aikirun/types/serializable";

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
