import { type DurationObject, type RetryStrategy, toMilliseconds, withRetry } from "@aikirun/lib";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { TaskInfo } from "@aikirun/types/task";
import type { DistributiveOmit } from "@aikirun/types/utils";
import {
	type TerminalWorkflowRunStatus,
	type WorkflowRun,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	type WorkflowRunState,
} from "@aikirun/types/workflow-run";
import type {
	WorkflowRunStateRequest,
	WorkflowRunTransitionStateResponseV1,
	WorkflowRunTransitionTaskStateRequestV1,
} from "@aikirun/types/workflow-run-api";

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
			request: DistributiveOmit<WorkflowRunTransitionTaskStateRequestV1, "id" | "expectedWorkflowRunRevision">
		) => Promise<TaskInfo>;
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
		this.events = createEventSenders(client.api, this._run.id, eventsDefinition, this.logger);

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

		const afterStateTransitionId = this._run.stateTransitionId;

		const isTerminated = async () => {
			const { terminated } = await this.api.workflowRun.hasTerminatedV1({
				id: this._run.id,
				afterStateTransitionId,
			});
			return terminated;
		};

		const shouldRetryOnResult = async (terminated: boolean) => !terminated;

		const maybeResult = options?.abortSignal
			? await withRetry(isTerminated, retryStrategy, {
					abortSignal: options.abortSignal,
					shouldRetryOnResult,
				}).run()
			: await withRetry(isTerminated, retryStrategy, { shouldRetryOnResult }).run();

		if (maybeResult.state === "timeout") {
			if (!Number.isFinite(maxAttempts)) {
				throw new Error("Something's wrong, this should've never timed out");
			}
			return { success: false, cause: "timeout" };
		}

		if (maybeResult.state === "aborted") {
			return { success: false, cause: "aborted" };
		}

		maybeResult.state satisfies "completed";

		await this.refresh();

		if (this._run.state.status === expectedStatus) {
			return {
				success: true,
				state: this._run.state as WorkflowRunWaitResultSuccess<Status, Output>,
			};
		}

		return { success: false, cause: "run_terminated" };
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
			let response: WorkflowRunTransitionStateResponseV1;
			if (
				(targetState.status === "scheduled" &&
					(targetState.reason === "new" || targetState.reason === "resume" || targetState.reason === "awake_early")) ||
				targetState.status === "paused" ||
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
		} catch (error) {
			if (isWorkflowRunRevisionConflictError(error)) {
				throw new WorkflowRunRevisionConflictError(this.run.id as WorkflowRunId);
			}
			throw error;
		}
	}

	private async transitionTaskState(
		request: DistributiveOmit<WorkflowRunTransitionTaskStateRequestV1, "id" | "expectedWorkflowRunRevision">
	): Promise<TaskInfo> {
		try {
			const { taskInfo } = await this.api.workflowRun.transitionTaskStateV1({
				...request,
				id: this.run.id,
				expectedWorkflowRunRevision: this.run.revision,
			});
			return taskInfo;
		} catch (error) {
			if (isWorkflowRunRevisionConflictError(error)) {
				throw new WorkflowRunRevisionConflictError(this.run.id as WorkflowRunId);
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

function isWorkflowRunRevisionConflictError(error: unknown): boolean {
	return (
		error != null && typeof error === "object" && "code" in error && error.code === "WORKFLOW_RUN_REVISION_CONFLICT"
	);
}
