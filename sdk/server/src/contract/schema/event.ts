import { type } from "arktype";

import { opaquePayloadSchema } from "./payload";

export const eventWaitSchema = type({
	status: "'received'",
	"data?": opaquePayloadSchema,
	clientCodecApplied: "boolean",
	receivedAt: "number > 0",
	"reference?": type({
		id: "string > 0",
	}).or("undefined"),
}).or({
	status: "'timeout'",
	timedOutAt: "number > 0",
});
