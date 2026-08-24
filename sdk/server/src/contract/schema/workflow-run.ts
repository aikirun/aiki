import { type } from "arktype";

import { eventWaitSchema } from "./event";
import { retryStrategySchema } from "./retry";
import { serializedErrorSchema } from "./serializable";
import { sleepSchema } from "./sleep";
import { taskInfoSchema } from "./task";
import { triggerStrategySchema } from "./trigger";
import { workflowSourceSchema } from "./workflow";

export const workflowRunStatusSchema = type(
	"'scheduled' | 'queued' | 'running' | 'paused' | 'sleeping' | 'awaiting_event' | 'awaiting_retry' | 'awaiting_child_workflow' | 'stalled' | 'cancelled' | 'failed' | 'completed'"
);

export const terminalWorkflowRunStatusSchema = type("'cancelled' | 'failed' | 'completed'");

const workflowReferenceSchema = type({
	id: "string > 0",
	"conflictPolicy?": "'error' | 'return_existing' | undefined",
});

export const workflowRunOptionsSchema = type({
	"pool?": "string | undefined",
	"retry?": retryStrategySchema,
});

export const workflowStartOptionsSchema = workflowRunOptionsSchema.and({
	"reference?": workflowReferenceSchema,
	"trigger?": triggerStrategySchema,
});

export const workflowRunStateScheduledSchema = type({
	status: "'scheduled'",
	reason: "'new'",
	scheduledAt: "number > 0",
})
	.or({ status: "'scheduled'", reason: "'wakeup_early'", scheduledAt: "number > 0" })
	.or({ status: "'scheduled'", reason: "'resumption'", scheduledAt: "number > 0" })
	.or({ status: "'scheduled'", reason: "'event'", scheduledAt: "number > 0" })
	.or({ status: "'scheduled'", reason: "'child_workflow'", scheduledAt: "number > 0" })
	.or({ status: "'scheduled'", reason: "'redelivery'", scheduledAt: "number > 0" });

const workflowRunQueuedReasonSchema = type(
	"'new' | 'retry' | 'task_retry' | 'wakeup' | 'wakeup_early' | 'resumption' | 'event' | 'event_wait_timeout' | 'child_workflow' | 'child_workflow_wait_timeout' | 'recovery' | 'redelivery'"
);

export const workflowRunStateQueuedSchema = type({
	status: "'queued'",
	reason: workflowRunQueuedReasonSchema,
});

export const workflowRunStateRunningSchema = type({
	status: "'running'",
});

export const workflowRunStatePausedSchema = type({
	status: "'paused'",
});

export const workflowRunStateSleepingSchema = type({
	status: "'sleeping'",
	sleepName: "string > 0",
	wakeupAt: "number > 0",
});

export const workflowRunStateAwaitingEventSchema = type({
	status: "'awaiting_event'",
	eventName: "string > 0",
	"timeoutAt?": "number | undefined",
});

export const workflowRunStateAwaitingRetrySchema = type({
	status: "'awaiting_retry'",
	cause: "'task'",
	taskId: "string > 0",
	nextAttemptAt: "number > 0",
})
	.or({
		status: "'awaiting_retry'",
		cause: "'child_workflow'",
		childWorkflowRunId: "string > 0",
		nextAttemptAt: "number > 0",
	})
	.or({
		status: "'awaiting_retry'",
		cause: "'self'",
		error: serializedErrorSchema,
		nextAttemptAt: "number > 0",
	});

export const workflowRunStateAwaitingChildWorkflowSchema = type({
	status: "'awaiting_child_workflow'",
	childWorkflowRunId: "string > 0",
	"timeoutAt?": "number > 0 | undefined",
});

export const workflowRunStateStalledSchema = type({
	status: "'stalled'",
});

export const workflowRunStateCancelledSchema = type({
	status: "'cancelled'",
	"explanation?": "string > 0 | undefined",
});

export const workflowRunStateCompletedSchema = type({
	status: "'completed'",
	output: "unknown",
});

export const workflowRunStateFailedSchema = type({
	status: "'failed'",
	cause: "'task'",
	taskId: "string > 0",
})
	.or({
		status: "'failed'",
		cause: "'child_workflow'",
		childWorkflowRunId: "string > 0",
	})
	.or({
		status: "'failed'",
		cause: "'self'",
		error: serializedErrorSchema,
	});

export const workflowRunStateSchema = workflowRunStateScheduledSchema
	.or(workflowRunStateQueuedSchema)
	.or(workflowRunStateRunningSchema)
	.or(workflowRunStatePausedSchema)
	.or(workflowRunStateSleepingSchema)
	.or(workflowRunStateAwaitingEventSchema)
	.or(workflowRunStateAwaitingRetrySchema)
	.or(workflowRunStateAwaitingChildWorkflowSchema)
	.or(workflowRunStateStalledSchema)
	.or(workflowRunStateCancelledSchema)
	.or(workflowRunStateCompletedSchema)
	.or(workflowRunStateFailedSchema);

export const terminalWorkflowRunStateSchema = workflowRunStateCancelledSchema
	.or(workflowRunStateCompletedSchema)
	.or(workflowRunStateFailedSchema);

const childWorkflowRunInfoSchema = type({
	id: "string > 0",
	name: "string > 0",
	versionId: "string > 0",
	inputHash: "string > 0",
	waits: type({
		timeouts: type({
			timedOutAt: "number > 0",
		}).array(),
		"terminal?": type({
			state: terminalWorkflowRunStateSchema,
			completedAt: "number > 0",
		}).or("undefined"),
	}),
});

export const workflowRunRecordSchema = type({
	id: "string > 0",
	name: "string > 0",
	versionId: "string > 0",
	source: workflowSourceSchema,
	createdAt: "number > 0",
	revision: "number >= 0",
	signalSequence: "number.integer >= 0",
	stateTransitionId: "string > 0",
	"input?": "unknown",
	inputHash: "string > 0",
	"referenceId?": "string > 0 | undefined",
	"options?": workflowRunOptionsSchema.or("undefined"),
	attempts: "number.integer >= 0",
	state: workflowRunStateSchema,
	tasks: type({ "[string]": taskInfoSchema.array() }),
	sleeps: type({ "[string]": sleepSchema.array() }),
	eventWaits: type({ "[string]": eventWaitSchema.array() }),
	childWorkflowRuns: type({ "[string]": childWorkflowRunInfoSchema.array() }),
	"parentWorkflowRunId?": "string > 0 | undefined",
});

const workflowRunStateScheduledRequestSchema = workflowRunStateScheduledSchema
	.omit("scheduledAt")
	.and({ scheduledInMs: "number.integer >= 0" });

export const workflowRunStateScheduledRequestPessimisticSchema = workflowRunStateScheduledRequestSchema.extract({
	reason: "'new' | 'wakeup_early' | 'resumption' | 'redelivery'",
});

export const workflowRunStateScheduledRequestOptimisticSchema = workflowRunStateScheduledRequestSchema.exclude(
	workflowRunStateScheduledRequestPessimisticSchema
);

export const listChildRunsRequestSchema = type({
	id: "string > 0",
	"childRunStatus?": workflowRunStatusSchema.array(),
});

export const listChildRunsResponseSchema = type({
	runs: type({
		id: "string > 0",
		"options?": type({
			"pool?": "string | undefined",
		}).or("undefined"),
	}).array(),
});

export const cancelByIdsRequestSchema = type({
	ids: type("string > 0").array().atLeastLength(1),
});

export const cancelByIdsResponseSchema = type({
	cancelledIds: type("string > 0").array(),
});

export const multicastEventResponseSchema = type({
	sentIds: type("string > 0").array(),
	failedIds: type("string > 0").array(),
});
