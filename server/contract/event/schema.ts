import { type } from "arktype";

export const eventStateSchema = type({
	status: "'received'",
	"data?": "unknown",
	receivedAt: "number",
	"reference?": type({
		id: "string > 0",
	}).or("undefined"),
}).or({
	status: "'timeout'",
	timedOutAt: "number",
});

export const eventsQueueSchema = type({
	events: eventStateSchema.array(),
});
