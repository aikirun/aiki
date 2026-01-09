import { type } from "arktype";

export const eventStateSchema = type({
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

export const eventsQueueSchema = type({
	events: eventStateSchema.array(),
});
