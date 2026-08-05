import { type } from "arktype";

export const sleepSchema = type({
	status: "'sleeping'",
	wakeupAt: "number > 0",
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
