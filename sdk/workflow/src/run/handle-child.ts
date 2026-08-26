import type { DurationObject } from "@aikirun/lib/duration";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	type TerminalWorkflowRunState,
	type WorkflowRunId,
	type WorkflowRunRecord,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";

import type { EventsDefinition } from "./event";
import { type WorkflowRunHandle, workflowRunHandle } from "./handle";

export function childWorkflowRunHandle<Input, Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	run: WorkflowRunRecord<Input, Output>,
	parentRunHandle: WorkflowRunHandle<unknown, unknown, Context, EventsDefinition>,
	logger: Logger,
	eventsDefinition?: TEvents
): ChildWorkflowRunHandle<Input, Output, Context, TEvents> {
	const handle = workflowRunHandle(client, run, eventsDefinition, logger);

	return {
		run: handle.run,
		events: handle.events,
		refresh: handle.refresh.bind(handle),
		wait: createWaiter(handle, parentRunHandle, logger),
		cancel: handle.cancel.bind(handle),
		pause: handle.pause.bind(handle),
		resume: handle.resume.bind(handle),
		wakeup: handle.wakeup.bind(handle),
		[INTERNAL]: handle[INTERNAL],
	};
}

export type ChildWorkflowRunHandle<Input, Output, Context, TEvents extends EventsDefinition = EventsDefinition> = Omit<
	WorkflowRunHandle<Input, Output, Context, TEvents>,
	"wait"
> & {
	/**
	 * Waits for the child workflow run to reach a terminal status.
	 *
	 * This method suspends the parent workflow until the child reaches any terminal status
	 * (`completed`, `failed`, or `cancelled`) or the optional timeout elapses.
	 *
	 * When the parent resumes, the result is deterministically replayed from stored wait results.
	 *
	 * Returns a result object:
	 * - `{ success: true, state }` - the child reached a terminal status; `state.status` says which
	 * - `{ success: false, cause: "timeout" }` - the timeout elapsed (only when a timeout is provided)
	 *
	 * @param options - Optional configuration with timeout
	 *
	 * @example
	 * // Wait indefinitely for the child to finish
	 * const result = await childHandle.wait();
	 * if (result.state.status === "completed") {
	 *   console.log(result.state.output);
	 * } else {
	 *   console.log(`Child ended ${result.state.status}`);
	 * }
	 *
	 * @example
	 * // Wait with a timeout
	 * const result = await childHandle.wait({ timeout: { minutes: 5 } });
	 * if (!result.success) {
	 *   console.log("Child workflow took too long");
	 * }
	 */
	wait(options?: ChildWorkflowRunWaitOptions<false>): Promise<ChildWorkflowRunWaitResult<Output, false>>;
	wait(options: ChildWorkflowRunWaitOptions<true>): Promise<ChildWorkflowRunWaitResult<Output, true>>;
};

export interface ChildWorkflowRunWaitOptions<Timed extends boolean> {
	timeout?: Timed extends true ? DurationObject : never;
}

export type ChildWorkflowRunWaitResult<Output, Timed extends boolean> = Timed extends true
	?
			| {
					success: true;
					state: TerminalWorkflowRunState<Output>;
			  }
			| {
					success: false;
					cause: "timeout";
			  }
	: {
			success: true;
			state: TerminalWorkflowRunState<Output>;
		};

function createWaiter<Input, Output, Context, TEvents extends EventsDefinition>(
	handle: WorkflowRunHandle<Input, Output, Context, TEvents>,
	parentRunHandle: WorkflowRunHandle<unknown, unknown, Context, EventsDefinition>,
	logger: Logger
) {
	let nextTimeoutIndex = 0;

	async function wait(options?: ChildWorkflowRunWaitOptions<false>): Promise<ChildWorkflowRunWaitResult<Output, false>>;
	async function wait(options: ChildWorkflowRunWaitOptions<true>): Promise<ChildWorkflowRunWaitResult<Output, true>>;

	async function wait(
		options?: ChildWorkflowRunWaitOptions<boolean>
	): Promise<ChildWorkflowRunWaitResult<Output, boolean>> {
		const { run } = handle;
		const waits = parentRunHandle.run.childWorkflowRunWaits[run.id] ?? { timeouts: [] };

		const timedOutWait = waits.timeouts[nextTimeoutIndex];
		if (timedOutWait) {
			nextTimeoutIndex++;

			logger.debug("Timed out waiting for child workflow");
			return {
				success: false,
				cause: "timeout",
			};
		}

		const { terminal } = waits;
		if (terminal) {
			return {
				success: true,
				state: terminal.state as TerminalWorkflowRunState<Output>,
			};
		}

		const timeoutInMs = options?.timeout && toMilliseconds(options.timeout);

		try {
			await parentRunHandle[INTERNAL].transitionState({
				status: "awaiting_child_workflow",
				childWorkflowRunId: run.id,
				timeoutInMs,
			});
			logger.info("Waiting for child Workflow", {
				...(timeoutInMs !== undefined ? { "aiki.timeoutInMs": timeoutInMs } : {}),
			});
		} catch (err) {
			if (err instanceof WorkflowRunRevisionConflictError) {
				throw new WorkflowRunSuspendedError(parentRunHandle.run.id as WorkflowRunId);
			}
			throw err;
		}

		throw new WorkflowRunSuspendedError(parentRunHandle.run.id as WorkflowRunId);
	}

	return wait;
}
