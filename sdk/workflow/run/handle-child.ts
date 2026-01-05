import { type DurationObject, toMilliseconds } from "@aikirun/lib";
import type { Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	isTerminalWorkflowRunStatus,
	type TerminalWorkflowRunStatus,
	type WorkflowRun,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";

import type { WorkflowRunContext } from "./context";
import type { EventsDefinition } from "./event";
import {
	type WorkflowRunHandle,
	type WorkflowRunWaitResult,
	type WorkflowRunWaitResultSuccess,
	workflowRunHandle,
} from "./handle";

export async function childWorkflowRunHandle<Input, Output, AppContext, TEventsDefinition extends EventsDefinition>(
	client: Client<AppContext>,
	run: WorkflowRun<Input, Output>,
	parentRun: WorkflowRunContext<unknown, AppContext, EventsDefinition>,
	logger: Logger,
	eventsDefinition?: TEventsDefinition
): Promise<ChildWorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
	const handle = await workflowRunHandle(client, run, eventsDefinition, logger);

	return {
		run: handle.run,
		events: handle.events,
		refresh: handle.refresh.bind(handle),
		waitForStatus: createStatusWaiter(handle, parentRun, logger),
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
	TEventsDefinition extends EventsDefinition = EventsDefinition,
> = Omit<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>, "waitForStatus"> & {
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

function createStatusWaiter<Input, Output, AppContext, TEventsDefinition extends EventsDefinition>(
	handle: WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>,
	parentRun: WorkflowRunContext<unknown, AppContext, EventsDefinition>,
	logger: Logger
) {
	let nextWaitIndex = 0;

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

		const waitResults = parentRunHandle.run.childWorkflowRuns[handle.run.path]?.statusWaitResults ?? [];

		const waitResult = waitResults[nextWaitIndex];
		if (waitResult) {
			nextWaitIndex++;

			if (waitResult.status === "timeout") {
				logger.debug("Timed out waiting for child workflow status", { "aiki.expectedStatus": expectedStatus });
				return {
					success: false,
					cause: "timeout",
				};
			}

			if (waitResult.childWorkflowRunState.status === expectedStatus) {
				return {
					success: true,
					state: waitResult.childWorkflowRunState as WorkflowRunWaitResultSuccess<Status, Output>,
				};
			}

			if (isTerminalWorkflowRunStatus(waitResult.childWorkflowRunState.status)) {
				logger.debug("Child workflow run reached termnial state");
				return {
					success: false,
					cause: "run_terminated",
				};
			}
		}

		const { state } = handle.run;
		if (state.status === expectedStatus) {
			return {
				success: true,
				state: state as WorkflowRunWaitResultSuccess<Status, Output>,
			};
		}

		if (isTerminalWorkflowRunStatus(state.status)) {
			logger.debug("Child workflow run reached termnial state");
			return {
				success: false,
				cause: "run_terminated",
			};
		}

		const timeoutInMs = options?.timeout && toMilliseconds(options.timeout);

		await parentRunHandle[INTERNAL].transitionState({
			status: "awaiting_child_workflow",
			childWorkflowRunId: handle.run.id,
			childWorkflowRunStatus: expectedStatus,
			timeoutInMs,
		});

		throw new WorkflowRunSuspendedError(parentRun.id);
	}

	return waitForStatus;
}
