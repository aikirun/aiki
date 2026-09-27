export interface SerializableError {
	message: string;
	name: string;
	stack?: string;
	cause?: SerializableError;
}

export function createSerializableError(err: unknown): SerializableError {
	return err instanceof Error
		? {
				message: err.message,
				name: err.name,
				stack: err.stack,
				cause: err.cause ? createSerializableError(err.cause) : undefined,
			}
		: {
				message: String(err),
				name: "UnknownError",
			};
}
