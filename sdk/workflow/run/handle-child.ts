import { toMilliseconds } from "@aikirun/lib/duration";
import type { Client } from "@aikirun/types/client";
import type { DurationObject } from "@aikirun/types/duration";
import type { Logger } from "@aikirun/types/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	type ChildWorkflowRunWaitQueue,
	isTerminalWorkflowRunStatus,
	type TerminalWorkflowRunStatus,
	type WorkflowRun,
} from "@aikirun/types/workflow-run";
import { WorkflowRunRevisionConflictError, WorkflowRunSuspendedError } from "@aikirun/types/workflow-run-error";

import type { WorkflowRunContext } from "./context";
import type { EventsDefinition } from "./event";
import {
	type WorkflowRunHandle,
	type WorkflowRunWaitResult,
	type WorkflowRunWaitResultSuccess,
	workflowRunHandle,
} from "./handle";

export async function childWorkflowRunHandle<Input, Output, AppContext, TEvents extends EventsDefinition>(
	client: Client<AppContext>,
	run: WorkflowRun<Input, Output>,
	parentRun: WorkflowRunContext<unknown, AppContext, EventsDefinition>,
	childWorkflowRunWaitQueues: Record<TerminalWorkflowRunStatus, ChildWorkflowRunWaitQueue>,
	logger: Logger,
	eventsDefinition?: TEvents
): Promise<ChildWorkflowRunHandle<Input, Output, AppContext, TEvents>> {
	const handle = await workflowRunHandle(client, run, eventsDefinition, logger);

	return {
		run: handle.run,
		events: handle.events,
		refresh: handle.refresh.bind(handle),
		waitForStatus: createStatusWaiter(handle, parentRun, childWorkflowRunWaitQueues, logger),
		cancel: handle.cancel.bind(handle),
		pause: handle.pause.bind(handle),
		resume: handle.resume.bind(handle),
		awake: handle.awake.bind(handle),
		[INTERNAL]: handle[INTERNAL],
	};
}

export type ChildWorkflowRunHandle<
	Input,
	Output,
	AppContext,
	TEvents extends EventsDefinition = EventsDefinition,
> = Omit<WorkflowRunHandle<Input, Output, AppContext, TEvents>, "waitForStatus"> & {
	/**
	 * Waits for the child workflow run to reach a terminal status.
	 *
	 * This method suspends the parent workflow until the child reaches the expected terminal status
	 * or the optional timeout elapses.
	 *
	 * When the parent resumes, the result is deterministically replayed from stored wait results.
	 *
	 * Returns a result object:
	 * - `{ success: true, state }` - child reached the expected status
	 * - `{ success: false, cause }` - child did not reach status
	 *
	 * Possible failure causes:
	 * - `"run_terminated"` - child reached a different terminal state than expected
	 * - `"timeout"` - timeout elapsed (only when timeout option provided)
	 *
	 * @param status - The target terminal status to wait for
	 * @param options - Optional configuration with timeout
	 *
	 * @example
	 * // Wait indefinitely for child to complete
	 * const result = await childHandle.waitForStatus("completed");
	 * if (result.success) {
	 *   console.log(result.state.output);
	 * } else {
	 *   console.log(`Child terminated: ${result.cause}`);
	 * }
	 *
	 * @example
	 * // Wait with a timeout
	 * const result = await childHandle.waitForStatus("completed", {
	 *   timeout: { minutes: 5 }
	 * });
	 * if (!result.success && result.cause === "timeout") {
	 *   console.log("Child workflow took too long");
	 * }
	 */
	waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options?: ChildWorkflowRunWaitOptions<false>
	): Promise<WorkflowRunWaitResult<Status, Output, false, false>>;
	waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: ChildWorkflowRunWaitOptions<true>
	): Promise<WorkflowRunWaitResult<Status, Output, true, false>>;
};

export interface ChildWorkflowRunWaitOptions<Timed extends boolean> {
	timeout?: Timed extends true ? DurationObject : never;
}

function createStatusWaiter<Input, Output, AppContext, TEvents extends EventsDefinition>(
	handle: WorkflowRunHandle<Input, Output, AppContext, TEvents>,
	parentRun: WorkflowRunContext<unknown, AppContext, EventsDefinition>,
	childWorkflowRunWaitQueues: Record<TerminalWorkflowRunStatus, ChildWorkflowRunWaitQueue>,
	logger: Logger
) {
	const nextIndexByStatus: Record<TerminalWorkflowRunStatus, number> = {
		cancelled: 0,
		completed: 0,
		failed: 0,
	};

	async function waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options?: ChildWorkflowRunWaitOptions<false>
	): Promise<WorkflowRunWaitResult<Status, Output, false, false>>;

	async function waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: ChildWorkflowRunWaitOptions<true>
	): Promise<WorkflowRunWaitResult<Status, Output, true, false>>;

	async function waitForStatus<Status extends TerminalWorkflowRunStatus>(
		expectedStatus: Status,
		options?: ChildWorkflowRunWaitOptions<boolean>
	): Promise<WorkflowRunWaitResult<Status, Output, boolean, false>> {
		const parentRunHandle = parentRun[INTERNAL].handle;

		const nextIndex = nextIndexByStatus[expectedStatus];

		const { run } = handle;

		const childWorkflowRunWaits = childWorkflowRunWaitQueues[expectedStatus].childWorkflowRunWaits;
		const existingChildWorkflowRunWait = childWorkflowRunWaits[nextIndex];

		if (existingChildWorkflowRunWait) {
			nextIndexByStatus[expectedStatus] = nextIndex + 1;

			if (existingChildWorkflowRunWait.status === "timeout") {
				logger.debug("Timed out waiting for child workflow status", {
					"aiki.childWorkflowExpectedStatus": expectedStatus,
				});
				return {
					success: false,
					cause: "timeout",
				};
			}

			const childWorkflowRunStatus = existingChildWorkflowRunWait.childWorkflowRunState.status;

			if (childWorkflowRunStatus === expectedStatus) {
				return {
					success: true,
					state: existingChildWorkflowRunWait.childWorkflowRunState as WorkflowRunWaitResultSuccess<Status, Output>,
				};
			}

			if (isTerminalWorkflowRunStatus(childWorkflowRunStatus)) {
				logger.debug("Child workflow run reached termnial state", {
					"aiki.childWorkflowTerminalStatus": childWorkflowRunStatus,
				});
				return {
					success: false,
					cause: "run_terminated",
				};
			}

			childWorkflowRunStatus satisfies never;
		}

		// TODO: if the child workflow is already in the expectedStatus or a terminal status,
		// 		 we might return early, but it is tricky and could lead to bugs.
		// Example:
		// - wait for child to complete
		// - realises child already completed, so return early
		// - on replay, wait for child to complete, but child is not longer in completed state
		// - now it starts waiting, which is a different outcome from the first run
		// For now, let's persist this waiting in the server, so that the replay will work nicely

		const timeoutInMs = options?.timeout && toMilliseconds(options.timeout);

		try {
			await parentRunHandle[INTERNAL].transitionState({
				status: "awaiting_child_workflow",
				childWorkflowRunId: run.id,
				childWorkflowRunStatus: expectedStatus,
				timeoutInMs,
			});
			logger.info("Waiting for child Workflow", {
				"aiki.childWorkflowExpectedStatus": expectedStatus,
				...(timeoutInMs !== undefined ? { "aiki.timeoutInMs": timeoutInMs } : {}),
			});
		} catch (error) {
			if (error instanceof WorkflowRunRevisionConflictError) {
				throw new WorkflowRunSuspendedError(parentRun.id);
			}
			throw error;
		}

		throw new WorkflowRunSuspendedError(parentRun.id);
	}

	return waitForStatus;
}
