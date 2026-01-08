import { type } from "arktype";

export const sleepStateSchema = type({
	status: "'sleeping'",
	awakeAt: "number",
})
	.or({
		status: "'completed'",
		durationMs: "number.integer > 0",
		completedAt: "number",
	})
	.or({
		status: "'cancelled'",
		cancelledAt: "number",
	});

export const sleepQueueSchema = type({
	sleeps: sleepStateSchema.array(),
});
