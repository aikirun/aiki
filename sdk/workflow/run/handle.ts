import { type DurationObject, type RetryStrategy, toMilliseconds, withRetry } from "@aikirun/lib";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { TaskId } from "@aikirun/types/task";
import type { DistributiveOmit } from "@aikirun/types/utils";
import {
	isTerminalWorkflowRunStatus,
	type TerminalWorkflowRunStatus,
	type WorkflowRun,
	WorkflowRunConflictError,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	type WorkflowRunState,
} from "@aikirun/types/workflow-run";
import type { WorkflowRunStateRequest, WorkflowRunTransitionTaskStateRequestV1 } from "@aikirun/types/workflow-run-api";

import { createEventSenders, type EventSenders, type EventsDefinition } from "./event";

export function workflowRunHandle<Input, Output, AppContext, TEvents extends EventsDefinition>(
	client: Client<AppContext>,
	id: WorkflowRunId,
	eventsDefinition?: TEvents,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output, AppContext, TEvents>>;

export function workflowRunHandle<Input, Output, AppContext, TEvents extends EventsDefinition>(
	client: Client<AppContext>,
	run: WorkflowRun<Input, Output>,
	eventsDefinition?: TEvents,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output, AppContext, TEvents>>;

export async function workflowRunHandle<Input, Output, AppContext, TEvents extends EventsDefinition>(
	client: Client<AppContext>,
	runOrId: WorkflowRunId | WorkflowRun<Input, Output>,
	eventsDefinition?: TEvents,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output, AppContext, TEvents>> {
	const run =
		typeof runOrId !== "string"
			? runOrId
			: ((await client.api.workflowRun.getByIdV1({ id: runOrId })).run as WorkflowRun<Input, Output>);

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

export interface WorkflowRunHandle<Input, Output, AppContext, TEvents extends EventsDefinition = EventsDefinition> {
	run: Readonly<WorkflowRun<Input, Output>>;

	events: EventSenders<TEvents>;

	refresh: () => Promise<void>;

	/**
	 *  Waits for the child workflow run to reach a terminal status by polling.
	 *
	 * Returns a result object:
	 * - `{ success: true, state }` - workflow reached the expected status
	 * - `{ success: false, cause }` - workflow did not reach status
	 *
	 * Possible failure causes:
	 * - `"run_terminated"` - workflow reached a terminal state other than expected
	 * - `"timeout"` - timeout elapsed (only when timeout option provided)
	 * - `"aborted"` - abort signal triggered (only when abortSignal option provided)
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
	 *   abortSignal: controller.signal
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

	cancel: (reason?: string) => Promise<void>;

	pause: () => Promise<void>;

	resume: () => Promise<void>;

	awake: () => Promise<void>;

	[INTERNAL]: {
		client: Client<AppContext>;
		transitionState: (state: WorkflowRunStateRequest) => Promise<void>;
		transitionTaskState: (
			request: DistributiveOmit<WorkflowRunTransitionTaskStateRequestV1, "id" | "expectedRevision">
		) => Promise<{ taskId: TaskId }>;
		assertExecutionAllowed: () => void;
	};
}

export interface WorkflowRunWaitOptions<Timed extends boolean, Abortable extends boolean> {
	interval?: DurationObject;
	timeout?: Timed extends true ? DurationObject : never;
	abortSignal?: Abortable extends true ? AbortSignal : never;
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

class WorkflowRunHandleImpl<Input, Output, AppContext, TEvents extends EventsDefinition>
	implements WorkflowRunHandle<Input, Output, AppContext, TEvents>
{
	private readonly api: ApiClient;
	public readonly events: EventSenders<TEvents>;
	public readonly [INTERNAL]: WorkflowRunHandle<Input, Output, AppContext, TEvents>[typeof INTERNAL];

	constructor(
		client: Client<AppContext>,
		private _run: WorkflowRun<Input, Output>,
		eventsDefinition: TEvents,
		private readonly logger: Logger
	) {
		this.api = client.api;
		this.events = createEventSenders(client.api, this._run.id, eventsDefinition, this.logger, (run) => {
			this._run = run as WorkflowRun<Input, Output>;
		});

		this[INTERNAL] = {
			client,
			transitionState: this.transitionState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
			assertExecutionAllowed: this.assertExecutionAllowed.bind(this),
		};
	}

	public get run(): Readonly<WorkflowRun<Input, Output>> {
		return this._run;
	}

	public async refresh() {
		const { run: currentRun } = await this.api.workflowRun.getByIdV1({ id: this.run.id });
		this._run = currentRun as WorkflowRun<Input, Output>;
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

	// TODO: instead checking the current state, use the transition history
	// because it is possible for a workflow to flash though a state
	// and the handle will never know that the workflow hit that state
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
		if (options?.abortSignal?.aborted) {
			return {
				success: false,
				cause: "aborted",
			};
		}

		const delayMs = options?.interval ? toMilliseconds(options.interval) : 1_000;
		const maxAttempts = options?.timeout
			? Math.ceil(toMilliseconds(options.timeout) / delayMs)
			: Number.POSITIVE_INFINITY;
		const retryStrategy: RetryStrategy = { type: "fixed", maxAttempts, delayMs };

		const loadState = async () => {
			await this.refresh();
			return this.run.state;
		};

		const isNeitherExpectedNorTerminal = (state: WorkflowRunState<Output>) =>
			state.status !== expectedStatus && !isTerminalWorkflowRunStatus(state.status);

		if (!Number.isFinite(maxAttempts) && !options?.abortSignal) {
			const maybeResult = await withRetry(loadState, retryStrategy, {
				shouldRetryOnResult: async (state) => isNeitherExpectedNorTerminal(state),
			}).run();

			if (maybeResult.state === "timeout") {
				throw new Error("Something's wrong, this should've never timed out");
			}

			if (maybeResult.result.status !== expectedStatus) {
				return {
					success: false,
					cause: "run_terminated",
				};
			}
			return {
				success: true,
				state: maybeResult.result as WorkflowRunWaitResultSuccess<Status, Output>,
			};
		}

		const maybeResult = options?.abortSignal
			? await withRetry(loadState, retryStrategy, {
					abortSignal: options.abortSignal,
					shouldRetryOnResult: async (state) => isNeitherExpectedNorTerminal(state),
				}).run()
			: await withRetry(loadState, retryStrategy, {
					shouldRetryOnResult: async (state) => isNeitherExpectedNorTerminal(state),
				}).run();

		this.logger.info("Maybe result", { maybeResult });

		if (maybeResult.state === "completed") {
			if (maybeResult.result.status !== expectedStatus) {
				return {
					success: false,
					cause: "run_terminated",
				};
			}
			return {
				success: true,
				state: maybeResult.result as WorkflowRunWaitResultSuccess<Status, Output>,
			};
		}

		return { success: false, cause: maybeResult.state };
	}

	public async cancel(reason?: string): Promise<void> {
		await this.transitionState({ status: "cancelled", reason });
		this.logger.info("Workflow cancelled");
	}

	public async pause(): Promise<void> {
		await this.transitionState({ status: "paused" });
		this.logger.info("Workflow paused");
	}

	public async resume(): Promise<void> {
		await this.transitionState({ status: "scheduled", scheduledInMs: 0, reason: "resume" });
		this.logger.info("Workflow resumed");
	}

	public async awake(): Promise<void> {
		await this.transitionState({ status: "scheduled", scheduledInMs: 0, reason: "awake_early" });
		this.logger.info("Workflow awoken");
	}

	private async transitionState(targetState: WorkflowRunStateRequest): Promise<void> {
		try {
			if (
				(targetState.status === "scheduled" &&
					(targetState.reason === "new" || targetState.reason === "resume" || targetState.reason === "awake_early")) ||
				targetState.status === "paused" ||
				targetState.status === "cancelled"
			) {
				const { run } = await this.api.workflowRun.transitionStateV1({
					type: "pessimistic",
					id: this.run.id,
					state: targetState,
				});
				this._run = run as WorkflowRun<Input, Output>;
				return;
			}
			const { run } = await this.api.workflowRun.transitionStateV1({
				type: "optimistic",
				id: this.run.id,
				state: targetState,
				expectedRevision: this.run.revision,
			});
			this._run = run as WorkflowRun<Input, Output>;
		} catch (error) {
			if (isConflictError(error)) {
				throw new WorkflowRunConflictError(this.run.id as WorkflowRunId);
			}
			throw error;
		}
	}

	private async transitionTaskState(
		request: DistributiveOmit<WorkflowRunTransitionTaskStateRequestV1, "id" | "expectedRevision">
	): Promise<{ taskId: TaskId }> {
		try {
			const { run, taskId } = await this.api.workflowRun.transitionTaskStateV1({
				...request,
				id: this.run.id,
				expectedRevision: this.run.revision,
			});
			this._run = run as WorkflowRun<Input, Output>;
			return { taskId: taskId as TaskId };
		} catch (error) {
			if (isConflictError(error)) {
				throw new WorkflowRunConflictError(this.run.id as WorkflowRunId);
			}
			throw error;
		}
	}

	private assertExecutionAllowed() {
		const status = this.run.state.status;
		if (status !== "queued" && status !== "running") {
			throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, status);
		}
	}
}

function isConflictError(error: unknown): boolean {
	return error != null && typeof error === "object" && "code" in error && error.code === "CONFLICT";
}
