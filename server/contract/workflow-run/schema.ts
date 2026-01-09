import { type } from "arktype";

import { eventsQueueSchema } from "../event/schema";
import { serializedErrorSchema } from "../serializable";
import { retryStrategySchema, triggerStrategySchema } from "../shared/schema";
import { sleepQueueSchema } from "../sleep/schema";
import { taskInfoSchema, taskStateSchema } from "../task/schema";

export const workflowRunStatusSchema = type(
	"'scheduled' | 'queued' | 'running' | 'paused' | 'sleeping' | 'awaiting_event' | 'awaiting_retry' | 'awaiting_child_workflow' | 'cancelled' | 'failed' | 'completed'"
);

const workflowReferenceOptionsSchema = type({
	id: "string > 0",
	"onConflict?": "'error' | 'return_existing' | undefined",
});

export const workflowOptionsSchema = type({
	"reference?": workflowReferenceOptionsSchema,
	"trigger?": triggerStrategySchema,
	"shard?": "string | undefined",
	"retry?": retryStrategySchema,
});

const workflowRunScheduledReasonSchema = type(
	"'new' | 'retry' | 'task_retry' | 'awake' | 'awake_early' | 'resume' | 'event' | 'child_workflow'"
);

export const workflowRunStateScheduledSchema = type({
	status: "'scheduled'",
	scheduledAt: "number > 0",
	reason: "'new'",
})
	.or({ status: "'scheduled'", scheduledAt: "number > 0", reason: "'retry'" })
	.or({ status: "'scheduled'", scheduledAt: "number > 0", reason: "'task_retry'" })
	.or({ status: "'scheduled'", scheduledAt: "number > 0", reason: "'awake'" })
	.or({ status: "'scheduled'", scheduledAt: "number > 0", reason: "'awake_early'" })
	.or({ status: "'scheduled'", scheduledAt: "number > 0", reason: "'resume'" })
	.or({ status: "'scheduled'", scheduledAt: "number > 0", reason: "'event'" })
	.or({ status: "'scheduled'", scheduledAt: "number > 0", reason: "'child_workflow'" });

export const workflowRunStateQueuedSchema = type({
	status: "'queued'",
	reason: workflowRunScheduledReasonSchema,
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
	durationMs: "number > 0",
});

export const workflowRunStateAwaitingEventSchema = type({
	status: "'awaiting_event'",
	eventName: "string > 0",
	"timeoutAt?": "number | undefined",
});

export const workflowRunStateAwaitingRetrySchema = type({
	status: "'awaiting_retry'",
	cause: "'task'",
	nextAttemptAt: "number > 0",
	taskId: "string > 0",
})
	.or({
		status: "'awaiting_retry'",
		cause: "'child_workflow'",
		nextAttemptAt: "number > 0",
		childWorkflowRunId: "string > 0",
	})
	.or({
		status: "'awaiting_retry'",
		cause: "'self'",
		nextAttemptAt: "number > 0",
		error: serializedErrorSchema,
	});

export const workflowRunStateAwaitingChildWorkflowSchema = type({
	status: "'awaiting_child_workflow'",
	childWorkflowRunId: "string > 0",
	childWorkflowRunStatus: workflowRunStatusSchema,
	"timeoutAt?": "number > 0 | undefined",
});

export const workflowRunStateCancelledSchema = type({
	status: "'cancelled'",
	"reason?": "string > 0 | undefined",
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
	.or(workflowRunStateCancelledSchema)
	.or(workflowRunStateCompletedSchema)
	.or(workflowRunStateFailedSchema);

const childWorkflowWaitResultSchema = type({
	status: "'completed'",
	completedAt: "number > 0",
	childWorkflowRunState: workflowRunStateSchema,
}).or({
	status: "'timeout'",
	timedOutAt: "number > 0",
});

const childWorkflowRunInfoSchema = type({
	id: "string > 0",
	inputHash: "string > 0",
	statusWaitResults: childWorkflowWaitResultSchema.array(),
});

export const workflowRunSchema = type({
	id: "string > 0",
	name: "string > 0",
	versionId: "string > 0",
	createdAt: "number > 0",
	revision: "number >= 0",
	"input?": "unknown",
	path: "string > 0",
	options: workflowOptionsSchema,
	attempts: "number.integer >= 0",
	state: workflowRunStateSchema,
	tasks: type({ "[string]": taskInfoSchema }),
	sleepsQueue: type({ "[string]": sleepQueueSchema }),
	eventsQueue: type({ "[string]": eventsQueueSchema }),
	childWorkflowRuns: type({ "[string]": childWorkflowRunInfoSchema }),
	"parentWorkflowRunId?": "string > 0 | undefined",
});

export const workflowRunTransitionSchema = type({
	id: "string > 0",
	createdAt: "number > 0",
	type: "'state'",
	state: workflowRunStateSchema,
}).or({
	id: "string > 0",
	createdAt: "number > 0",
	type: "'task_state'",
	taskId: "string > 0",
	taskState: taskStateSchema,
});

export const workflowRunStateScheduledRequestOptimisticSchema = type({
	status: "'scheduled'",
	scheduledInMs: "number.integer >= 0",
	reason: "'retry'",
})
	.or({ status: "'scheduled'", scheduledInMs: "number.integer >= 0", reason: "'task_retry'" })
	.or({ status: "'scheduled'", scheduledInMs: "number.integer >= 0", reason: "'awake'" })
	.or({ status: "'scheduled'", scheduledInMs: "number.integer >= 0", reason: "'event'" })
	.or({ status: "'scheduled'", scheduledInMs: "number.integer >= 0", reason: "'child_workflow'" });

export const workflowRunStateScheduledRequestPessimisticSchema = type({
	status: "'scheduled'",
	scheduledInMs: "number.integer >= 0",
	reason: "'new'",
})
	.or({ status: "'scheduled'", scheduledInMs: "number.integer >= 0", reason: "'awake_early'" })
	.or({ status: "'scheduled'", scheduledInMs: "number.integer >= 0", reason: "'resume'" });

export const workflowRunStateAwaitingEventRequestSchema = type({
	status: "'awaiting_event'",
	eventName: "string > 0",
	"timeoutInMs?": "number.integer > 0 | undefined",
});

export const workflowRunStateAwaitingRetryRequestSchema = type({
	status: "'awaiting_retry'",
	cause: "'task'",
	taskId: "string > 0",
	nextAttemptInMs: "number.integer > 0",
})
	.or({
		status: "'awaiting_retry'",
		cause: "'child_workflow'",
		childWorkflowRunId: "string > 0",
		nextAttemptInMs: "number.integer > 0",
	})
	.or({
		status: "'awaiting_retry'",
		cause: "'self'",
		error: serializedErrorSchema,
		nextAttemptInMs: "number.integer > 0",
	});

export const workflowRunStateAwaitingChildWorkflowRequestSchema = type({
	status: "'awaiting_child_workflow'",
	childWorkflowRunId: "string > 0",
	childWorkflowRunStatus: workflowRunStatusSchema,
	"timeoutInMs?": "number.integer > 0 | undefined",
});

export const workflowRunStateCompletedRequestSchema = type({
	status: "'completed'",
	"output?": "unknown",
});

const taskStateOutputSchema = type({
	status: "'completed'",
	output: "unknown",
}).or({
	status: "'failed'",
	error: serializedErrorSchema,
});

export const workflowRunSetTaskStateRequestSchema = type({
	type: "'new'",
	id: "string > 0",
	taskName: "string > 0",
	"input?": "unknown",
	"reference?": { id: "string > 0" },
	state: taskStateOutputSchema,
}).or({
	type: "'existing'",
	id: "string > 0",
	taskId: "string > 0",
	state: taskStateOutputSchema,
});
