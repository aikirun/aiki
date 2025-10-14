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

/**
 * Type guard to detect conflict errors from the ORPC server.
 * Handles multiple error formats for robustness:
 * - ORPC error with code property
 * - HTTP error with status 409
 * - ConflictError by name
 */
export function isServerConflictError(error: unknown): boolean {
	if (error === null || typeof error !== "object") {
		return false;
	}

	// Check for ORPC error code
	if ("code" in error && error.code === "CONFLICT") {
		return true;
	}

	// Check for HTTP 409 status
	if ("status" in error && error.status === 409) {
		return true;
	}

	// Check for ConflictError by name
	if (error instanceof Error && error.name === "ConflictError") {
		return true;
	}

	// Check for ORPC error with status in data
	if (
		"data" in error &&
		error.data !== null &&
		typeof error.data === "object" &&
		"status" in error.data &&
		error.data.status === 409
	) {
		return true;
	}

	return false;
}
