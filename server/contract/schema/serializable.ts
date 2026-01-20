import { scope } from "arktype";

const errorScope = scope({
	serializableError: {
		message: "string",
		name: "string",
		"stack?": "string | undefined",
		"cause?": "serializableError | undefined",
	},
}).export();

export const serializedErrorSchema = errorScope.serializableError;
