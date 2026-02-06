import { type } from "arktype";

export const sleepSchema = type({
	status: "'sleeping'",
	awakeAt: "number > 0",
})
	.or({
		status: "'completed'",
		durationMs: "number.integer > 0",
		completedAt: "number > 0",
	})
	.or({
		status: "'cancelled'",
		cancelledAt: "number > 0",
	});

export const sleepQueueSchema = type({
	sleeps: sleepSchema.array(),
});
