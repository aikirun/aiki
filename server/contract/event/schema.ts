import { type } from "arktype";

export const eventWaitStateSchema = type({
	status: "'received'",
	"data?": "unknown",
	receivedAt: "number > 0",
	"reference?": type({
		id: "string > 0",
	}).or("undefined"),
}).or({
	status: "'timeout'",
	timedOutAt: "number > 0",
});

export const eventWaitQueueSchema = type({
	eventWaits: eventWaitStateSchema.array(),
});
