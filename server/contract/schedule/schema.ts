import { type } from "arktype";

export const overlapPolicySchema = type("'allow' | 'skip' | 'cancel_previous'");

export const cronScheduleSpecSchema = type({
	type: "'cron'",
	expression: "string > 0",
	"timezone?": "string | undefined",
	"overlapPolicy?": overlapPolicySchema.or("undefined"),
});

export const intervalScheduleSpecSchema = type({
	type: "'interval'",
	everyMs: "number > 0",
	"overlapPolicy?": overlapPolicySchema.or("undefined"),
});

export const scheduleSpecSchema = cronScheduleSpecSchema.or(intervalScheduleSpecSchema);

export const scheduleStatusSchema = type("'active' | 'paused' | 'deleted'");

export const scheduleSchema = type({
	id: "string > 0",
	name: "string > 0",
	workflowName: "string > 0",
	workflowVersionId: "string > 0",
	"input?": "unknown",
	spec: scheduleSpecSchema,
	status: scheduleStatusSchema,
	createdAt: "number > 0",
	updatedAt: "number > 0",
	"lastOccurrence?": "number > 0 | undefined",
	nextRunAt: "number > 0",
	runCount: "number.integer >= 0",
});
