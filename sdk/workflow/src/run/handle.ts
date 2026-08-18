import { delay } from "@aikirun/lib/async";
import type { DurationObject } from "@aikirun/lib/duration";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import type { DistributiveOmit } from "@aikirun/lib/object";
import type { TaskTransitionStateRequestV1 } from "@aikirun/types/api/task";
import type { WorkflowRunStateRequest, WorkflowRunTransitionStateResponseV1 } from "@aikirun/types/api/workflow-run";
import type { ApiClient, Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type {
	TerminalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunRecord,
	WorkflowRunState,
} from "@aikirun/types/workflow/run";
import { WorkflowRunNotExecutableError, WorkflowRunRevisionConflictError } from "@aikirun/types/workflow/run";
import type { TaskInfo } from "@aikirun/types/workflow/task";

import { createEventSenders, type EventSenders, type EventsDefinition } from "./event";

export function workflowRunHandle<Input, Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	id: WorkflowRunId,
	eventsDefinition?: TEvents,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>>;

export function workflowRunHandle<Input, Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	run: WorkflowRunRecord<Input, Output>,
	eventsDefinition?: TEvents,
	logger?: Logger
): WorkflowRunHandle<Input, Output, Context, TEvents>;

export function workflowRunHandle<Input, Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	runOrId: WorkflowRunId | WorkflowRunRecord<Input, Output>,
	eventsDefinition?: TEvents,
	logger?: Logger
): WorkflowRunHandle<Input, Output, Context, TEvents> | Promise<WorkflowRunHandle<Input, Output, Context, TEvents>> {
	if (typeof runOrId === "string") {
		const runId = runOrId;
		return (async () => {
			const run = (await client.api.workflowRun.getByIdV1({ id: runId })).run as WorkflowRunRecord<Input, Output>;
			return new WorkflowRunHandleImpl(
				client,
				run,
				eventsDefinition ?? ({} as TEvents),
				logger ??
					client.logger.child({
						"aiki.workflowName": run.name,
						"aiki.workflowVersionId": run.versionId,
						"aiki.workflowRunId": run.id,
					})
			);
		})();
	}

	const run = runOrId;
	return new WorkflowRunHandleImpl(
		client,
		run,
		eventsDefinition ?? ({} as TEvents),
		logger ??
			client.logger.child({
				"aiki.workflowName": run.name,
				"aiki.workflowVersionId": run.versionId,
				"aiki.workflowRunId": run.id,
			})
	);
}

export interface WorkflowRunHandle<Input, Output, Context, TEvents extends EventsDefinition = EventsDefinition> {
	run: Readonly<WorkflowRunRecord<Input, Output>>;

	events: EventSenders<TEvents>;

	refresh: () => Promise<void>;

	/**
	 * Waits for the workflow run to reach a terminal status by polling.
	 *
	 * Returns a result object:
	 * - `{ success: true, state }` - workflow reached the expected status
	 * - `{ success: false, cause }` - workflow did not reach status
	 *
	 * Possible failure causes:
	 * - `"run_terminated"` - workflow reached a terminal state other than expected
	 * - `"timeout"` - the wall-clock timeout elapsed (only when timeout option provided);
	 *   a final poll happens at the deadline before the wait gives up
	 * - `"aborted"` - abort signal triggered (only when signal option provided)
	 *
	 * @param status - The target status to wait for
	 * @param options - Optional configuration for polling interval, timeout, and abort signal
	 *
	 * @example
	 * // Wait indefinitely until completed or the workflow reaches another terminal state
	 * const result = await handle.waitForStatus("completed");
	 * if (result.success) {
	 *   console.log(result.state.output);
	 * } else {
	 *   console.log(`Workflow terminated: ${result.cause}`);
	 * }
	 *
	 * @example
	 * // Wait with a timeout
	 * const result = await handle.waitForStatus("completed", {
	 *   timeout: { seconds: 30 }
	 * });
	 * if (result.success) {
	 *   console.log(result.state.output);
	 * } else if (result.cause === "timeout") {
	 *   console.log("Timed out waiting for completion");
	 * }
	 *
	 * @example
	 * // Wait with an abort signal
	 * const controller = new AbortController();
	 * const result = await handle.waitForStatus("completed", {
	 *   signal: controller.signal
	 * });
	 * if (!result.success) {
	 *   console.log(`Wait ended: ${result.cause}`);
	 * }
	 */
	waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options?: WorkflowRunWaitOptions<false, false>
	): Promise<WorkflowRunWaitResult<Status, Output, false, false>>;
	waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, false>
	): Promise<WorkflowRunWaitResult<Status, Output, true, false>>;
	waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<false, true>
	): Promise<WorkflowRunWaitResult<Status, Output, false, true>>;
	waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, true>
	): Promise<WorkflowRunWaitResult<Status, Output, true, true>>;

	cancel: (explanation?: string) => Promise<void>;

	pause: () => Promise<void>;

	resume: () => Promise<void>;

	wakeup: () => Promise<void>;

	[INTERNAL]: {
		client: Client<Context>;
		transitionState: (state: WorkflowRunStateRequest) => Promise<void>;
		transitionTaskState: (
			request: DistributiveOmit<TaskTransitionStateRequestV1, "workflowRunId" | "expectedWorkflowRunRevision">
		) => Promise<TaskInfo>;
		assertExecutionAllowed: () => void;
	};
}

export interface WorkflowRunWaitOptions<Timed extends boolean, Abortable extends boolean> {
	interval?: DurationObject;
	timeout?: Timed extends true ? DurationObject : never;
	signal?: Abortable extends true ? AbortSignal : never;
}

export type WorkflowRunWaitResultSuccess<Status extends TerminalWorkflowRunStatus, Output> = Extract<
	WorkflowRunState<Output>,
	{ status: Status }
>;

export type WorkflowRunWaitResult<
	Status extends TerminalWorkflowRunStatus,
	Output,
	Timed extends boolean,
	Abortable extends boolean,
> =
	| {
			success: false;
			cause: "run_terminated" | (Timed extends true ? "timeout" : never) | (Abortable extends true ? "aborted" : never);
	  }
	| {
			success: true;
			state: WorkflowRunWaitResultSuccess<Status, Output>;
	  };

class WorkflowRunHandleImpl<Input, Output, Context, TEvents extends EventsDefinition>
	implements WorkflowRunHandle<Input, Output, Context, TEvents>
{
	private readonly api: ApiClient;
	public readonly events: EventSenders<TEvents>;
	public readonly [INTERNAL]: WorkflowRunHandle<Input, Output, Context, TEvents>[typeof INTERNAL];

	constructor(
		client: Client<Context>,
		private _run: WorkflowRunRecord<Input, Output>,
		eventsDefinition: TEvents,
		private readonly logger: Logger
	) {
		this.api = client.api;
		this.events = createEventSenders(client.api, this._run.id, eventsDefinition, this.logger);

		this[INTERNAL] = {
			client,
			transitionState: this.transitionState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
			assertExecutionAllowed: this.assertExecutionAllowed.bind(this),
		};
	}

	public get run(): Readonly<WorkflowRunRecord<Input, Output>> {
		return this._run;
	}

	public async refresh() {
		// TODO: when chunking is implemented, refresh should load only data after it's cursor
		const { run: currentRun } = await this.api.workflowRun.getByIdV1({ id: this.run.id });
		this._run = currentRun as WorkflowRunRecord<Input, Output>;
	}

	public async waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options?: WorkflowRunWaitOptions<false, false>
	): Promise<WorkflowRunWaitResult<Status, Output, false, false>>;

	public async waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, false>
	): Promise<WorkflowRunWaitResult<Status, Output, true, false>>;

	public async waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<false, true>
	): Promise<WorkflowRunWaitResult<Status, Output, false, true>>;

	public async waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, true>
	): Promise<WorkflowRunWaitResult<Status, Output, true, true>>;

	public async waitForStatus<Status extends TerminalWorkflowRunStatus>(
		status: Status,
		options?: WorkflowRunWaitOptions<boolean, boolean>
	): Promise<WorkflowRunWaitResult<Status, Output, boolean, boolean>> {
		return this.waitForStatusByPolling(status, options);
	}

	private async waitForStatusByPolling<Status extends TerminalWorkflowRunStatus>(
		expectedStatus: Status,
		options?: WorkflowRunWaitOptions<boolean, boolean>
	): Promise<WorkflowRunWaitResult<Status, Output, boolean, boolean>> {
		const signal = options?.signal;
		const intervalMs = options?.interval ? toMilliseconds(options.interval) : 1_000;
		const timeoutAt = options?.timeout ? Date.now() + toMilliseconds(options.timeout) : undefined;

		let afterStateTransitionId = this._run.stateTransitionId;
		let finalPoll = false;

		while (!signal?.aborted) {
			let terminated: boolean;
			try {
				const response = await this.api.workflowRun.hasTerminatedV1({
					id: this._run.id,
					afterStateTransitionId,
				});
				afterStateTransitionId = response.latestStateTransitionId;
				terminated = response.terminated;
			} catch (err) {
				this.logger.warn("Failed while checking if workflow has terminated", { err });
				terminated = false;
			}

			if (terminated) {
				await this.refresh();

				// TODO: If the run transitions from failed -> awaiting_retry between the refresh and this check,
				// a wrong response will be sent to the caller i.e. { success: false, cause: "run_terminated" }.
				// The correct response should be { success: true, state }
				if (this._run.state.status === expectedStatus) {
					return {
						success: true,
						state: this._run.state as WorkflowRunWaitResultSuccess<Status, Output>,
					};
				}

				return { success: false, cause: "run_terminated" };
			}

			if (finalPoll) {
				return { success: false, cause: "timeout" };
			}

			let delayMs = intervalMs;
			if (timeoutAt !== undefined) {
				const remainingTimeoutMs = timeoutAt - Date.now();
				if (remainingTimeoutMs <= 0) {
					return { success: false, cause: "timeout" };
				}

				// The last sleep is capped to the remaining timeout budget, so the run gets
				// exactly one final poll at the deadline before the wait gives up, regardless
				// of timer precision.
				if (remainingTimeoutMs <= intervalMs) {
					delayMs = remainingTimeoutMs;
					finalPoll = true;
				}
			}

			try {
				await delay(delayMs, { signal });
			} catch {
				return { success: false, cause: "aborted" };
			}
		}

		return { success: false, cause: "aborted" };
	}

	public async cancel(explanation?: string): Promise<void> {
		await this.transitionState({ status: "cancelled", explanation });
		this.logger.info("Workflow cancelled");
	}

	public async pause(): Promise<void> {
		await this.transitionState({ status: "paused" });
		this.logger.info("Workflow paused");
	}

	public async resume(): Promise<void> {
		await this.transitionState({ status: "scheduled", scheduledInMs: 0, reason: "resumption" });
		this.logger.info("Workflow resumed");
	}

	public async wakeup(): Promise<void> {
		await this.transitionState({ status: "scheduled", scheduledInMs: 0, reason: "wakeup_early" });
		this.logger.info("Workflow woken up");
	}

	private async transitionState(targetState: WorkflowRunStateRequest): Promise<void> {
		try {
			let response: WorkflowRunTransitionStateResponseV1;
			if (
				(targetState.status === "scheduled" &&
					(targetState.reason === "new" ||
						targetState.reason === "resumption" ||
						targetState.reason === "wakeup_early" ||
						targetState.reason === "redelivery")) ||
				targetState.status === "paused" ||
				targetState.status === "stalled" ||
				targetState.status === "cancelled"
			) {
				response = await this.api.workflowRun.transitionStateV1({
					type: "pessimistic",
					id: this.run.id,
					state: targetState,
				});
			} else {
				response = await this.api.workflowRun.transitionStateV1({
					type: "optimistic",
					id: this.run.id,
					state: targetState,
					expectedRevision: this.run.revision,
				});
			}
			this._run.revision = response.revision;
			this._run.state = response.state as WorkflowRunState<Output>;
			this._run.attempts = response.attempts;
		} catch (err) {
			if (isWorkflowRunRevisionConflictError(err)) {
				throw new WorkflowRunRevisionConflictError(this.run.id as WorkflowRunId);
			}
			throw err;
		}
	}

	private async transitionTaskState(
		request: DistributiveOmit<TaskTransitionStateRequestV1, "workflowRunId" | "expectedWorkflowRunRevision">
	): Promise<TaskInfo> {
		try {
			const { taskInfo } = await this.api.task.transitionStateV1({
				...request,
				workflowRunId: this.run.id,
				expectedWorkflowRunRevision: this.run.revision,
			});
			return taskInfo;
		} catch (err) {
			if (isWorkflowRunRevisionConflictError(err)) {
				throw new WorkflowRunRevisionConflictError(this.run.id as WorkflowRunId);
			}
			throw err;
		}
	}

	private assertExecutionAllowed() {
		const status = this.run.state.status;
		if (status !== "queued" && status !== "running") {
			throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, status);
		}
	}
}

export function isWorkflowRunRevisionConflictError(err: unknown): boolean {
	return err != null && typeof err === "object" && "code" in err && err.code === "WORKFLOW_RUN_REVISION_CONFLICT";
}
