import { createBinaryLatch } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import { WorkflowRunRevisionConflictError } from "@aikirun/types/workflow/run";

import type { WorkflowRunHandle } from "./handle";

export type CreateTaskExecutionTracker = () => TaskExecutionTracker;

export interface TaskExecutionTracker {
	/** Call when the task being tracked is awaiting a retry. */
	awaitingRetry(): void;
	end(): void;
}

/**
 * Tracks the task executions of one execution of a workflow run.
 *
 * `create` mints a tracker for a single task execution: the task reports through it
 * that it is awaiting a retry, and `end` marks the execution finished. `flush` waits
 * until every created tracker has ended, then transitions the run to
 * `awaiting_task_retry` when a task reported awaiting a retry and the run is still
 * `running`; otherwise it does nothing. `flush` never throws.
 */
export function taskExecutionTracker(
	handle: WorkflowRunHandle<unknown, unknown, unknown>,
	logger: Logger
): {
	create: CreateTaskExecutionTracker;
	flush: () => Promise<void>;
} {
	const idle = createBinaryLatch();
	let openExecutions = 0;
	let anyAwaitingRetry = false;

	return {
		create() {
			openExecutions++;
			let ended = false;
			return {
				awaitingRetry() {
					anyAwaitingRetry = true;
				},
				end() {
					if (ended) {
						return;
					}
					ended = true;
					openExecutions--;
					if (openExecutions === 0) {
						idle.signal();
					}
				},
			};
		},
		async flush() {
			while (openExecutions > 0) {
				await idle.wait();
			}

			if (!anyAwaitingRetry) {
				return;
			}

			if (handle.run.state.status !== "running") {
				return;
			}

			try {
				await handle[INTERNAL].transitionState({ status: "awaiting_task_retry" });
			} catch (err) {
				if (err instanceof WorkflowRunRevisionConflictError) {
					return;
				}
				logger.warn("Failed to transition the run to awaiting_task_retry", { err });
			}
		},
	};
}
