export type SerializableInput =
	| null
	| string
	| number
	| boolean
	| { [key: string]: SerializableInput }
	| SerializableInput[];

export interface SerializableError {
	message: string;
	name: string;
	stack?: string;
	cause?: SerializableError;
}

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
