import { type } from "arktype";

import { opaquePayloadSchema } from "./payload";
import { workflowSourceSchema } from "./workflow";
import { workflowRunOptionsSchema } from "./workflow-run";

export const overlapPolicySchema = type("'allow' | 'skip' | 'cancel_previous'");

export const cronScheduleSpecSchema = type({
	type: "'cron'",
	expression: "string > 0",
	"timezone?": "string | undefined",
	"overlapPolicy?": overlapPolicySchema.or("undefined"),
});

export const intervalScheduleSpecSchema = type({
	type: "'interval'",
	everyMs: "number.integer > 0",
	"overlapPolicy?": overlapPolicySchema.or("undefined"),
});

export const scheduleSpecSchema = cronScheduleSpecSchema.or(intervalScheduleSpecSchema);

export const scheduleStatusSchema = type("'active' | 'paused' | 'inactive'");

export const scheduleConflictPolicySchema = type("'error' | 'return_existing'");

export const scheduleReferenceSchema = type({
	id: "string > 0",
	"conflictPolicy?": scheduleConflictPolicySchema.or("undefined"),
});

export const scheduleActivateOptionsSchema = type({
	"reference?": scheduleReferenceSchema.or("undefined"),
});

export const scheduleWorkflowFilterSchema = type({
	name: "string > 0",
	"versionId?": "string > 0 | undefined",
	source: workflowSourceSchema,
});

export const scheduleSchema = type({
	id: "string > 0",
	workflowSource: workflowSourceSchema,
	workflowName: "string > 0",
	workflowVersionId: "string > 0",
	"workflowRunInput?": opaquePayloadSchema,
	spec: scheduleSpecSchema,
	status: scheduleStatusSchema,
	"referenceId?": "string > 0 | undefined",
	"workflowRunOptions?": workflowRunOptionsSchema.or("undefined"),
	createdAt: "number > 0",
	updatedAt: "number > 0",
	"lastOccurrence?": "number > 0 | undefined",
	nextRunAt: "number > 0",
});
