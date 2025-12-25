import { type DurationObject, type RetryStrategy, toMilliseconds, withRetry } from "@aikirun/lib";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { TaskPath } from "@aikirun/types/task";
import {
	type WorkflowRun,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	type WorkflowRunState,
	type WorkflowRunStatus,
} from "@aikirun/types/workflow-run";
import type { TaskStateRequest, WorkflowRunStateRequest } from "@aikirun/types/workflow-run-api";

import { createEventSenders, type EventSenders, type EventsDefinition } from "./event";

export function workflowRunHandle<Input, Output, TEventsDefinition extends EventsDefinition>(
	client: Client,
	id: WorkflowRunId,
	eventsDefinition?: TEventsDefinition,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output, TEventsDefinition>>;

export function workflowRunHandle<Input, Output, TEventsDefinition extends EventsDefinition>(
	client: Client,
	run: WorkflowRun<Input, Output>,
	eventsDefinition?: TEventsDefinition,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output, TEventsDefinition>>;

export async function workflowRunHandle<Input, Output, TEventsDefinition extends EventsDefinition>(
	client: Client,
	runOrId: WorkflowRunId | WorkflowRun<Input, Output>,
	eventsDefinition?: TEventsDefinition,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output, TEventsDefinition>> {
	const run =
		typeof runOrId !== "string"
			? runOrId
			: ((await client.api.workflowRun.getByIdV1({ id: runOrId })).run as WorkflowRun<Input, Output>);

	return new WorkflowRunHandleImpl(
		client.api,
		run,
		eventsDefinition ?? ({} as TEventsDefinition),
		logger ?? client.logger.child({ "aiki.workflowRunId": run.id })
	);
}

export interface WorkflowRunHandle<Input, Output, TEventsDefinition extends EventsDefinition = EventsDefinition> {
	run: Readonly<WorkflowRun<Input, Output>>;

	events: EventSenders<TEventsDefinition>;

	refresh: () => Promise<void>;

	/**
	 * Waits for the workflow run to reach a specific status by polling.
	 *
	 * The return type varies based on the options provided:
	 * - No timeout or abort signal: Returns the state directly
	 * - With timeout: Returns `{ success: true, state }` or `{ success: false, cause: "timeout" }`
	 * - With abort signal: Returns `{ success: true, state }` or `{ success: false, cause: "aborted" }`
	 *
	 * @param status - The target status to wait for
	 * @param options - Optional configuration for polling interval, timeout, and abort signal
	 *
	 * @example
	 * // Wait indefinitely until completed (returns state directly)
	 * const state = await handle.waitForStatus("completed");
	 * console.log(state.output);
	 *
	 * @example
	 * // Wait with a timeout (must check success)
	 * const result = await handle.waitForStatus("completed", {
	 *   timeout: { seconds: 30 },
	 *   interval: { seconds: 2 }
	 * });
	 * if (result.success) {
	 *   console.log(result.state.output);
	 * } else {
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
	 *   console.log(`Wait was ${result.cause}`);
	 * }
	 */
	waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options?: WorkflowRunWaitOptions<false, false>
	): Promise<WorkflowRunWaitResultSuccess<Status, Output>>;
	waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, false>
	): Promise<WorkflowRunWaitResult<Status, Output, true, false>>;
	waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<false, true>
	): Promise<WorkflowRunWaitResult<Status, Output, false, true>>;
	waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, true>
	): Promise<WorkflowRunWaitResult<Status, Output, true, true>>;

	cancel: (reason?: string) => Promise<void>;

	pause: () => Promise<void>;

	resume: () => Promise<void>;

	[INTERNAL]: {
		transitionState: (state: WorkflowRunStateRequest) => Promise<void>;
		transitionTaskState: (taskPath: TaskPath, taskState: TaskStateRequest) => Promise<void>;
		assertExecutionAllowed: () => void;
	};
}

export interface WorkflowRunWaitOptions<Timed extends boolean, Abortable extends boolean> {
	interval?: DurationObject;
	timeout?: Timed extends true ? DurationObject : never;
	abortSignal?: Abortable extends true ? AbortSignal : never;
}

export type WorkflowRunWaitResultSuccess<Status extends WorkflowRunStatus, Output> = Extract<
	WorkflowRunState<Output>,
	{ status: Status }
>;

export type WorkflowRunWaitResult<
	Status extends WorkflowRunStatus,
	Output,
	Timed extends boolean,
	Abortable extends boolean,
> =
	| {
			success: false;
			cause: (Timed extends true ? "timeout" : never) | (Abortable extends true ? "aborted" : never);
	  }
	| {
			success: true;
			state: WorkflowRunWaitResultSuccess<Status, Output>;
	  };

class WorkflowRunHandleImpl<Input, Output, TEventsDefinition extends EventsDefinition>
	implements WorkflowRunHandle<Input, Output, TEventsDefinition>
{
	public readonly events: EventSenders<TEventsDefinition>;
	public readonly [INTERNAL]: WorkflowRunHandle<Input, Output, TEventsDefinition>[typeof INTERNAL];

	constructor(
		private readonly api: ApiClient,
		private _run: WorkflowRun<Input, Output>,
		eventsDefinition: TEventsDefinition,
		private readonly logger: Logger
	) {
		this.events = createEventSenders(this.api, this._run.id, eventsDefinition, this.logger, (run) => {
			this._run = run as WorkflowRun<Input, Output>;
		});

		this[INTERNAL] = {
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

	public async waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options?: WorkflowRunWaitOptions<false, false>
	): Promise<WorkflowRunWaitResultSuccess<Status, Output>>;
	public async waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, false>
	): Promise<WorkflowRunWaitResult<Status, Output, true, false>>;
	public async waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<false, true>
	): Promise<WorkflowRunWaitResult<Status, Output, false, true>>;
	public async waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options: WorkflowRunWaitOptions<true, true>
	): Promise<WorkflowRunWaitResult<Status, Output, true, true>>;
	// TODO: instead polling the current state, use the transition history
	// because it is entirely possible for a workflow to flash though a state
	// and the handle will never know that the workflow hit that state
	public async waitForStatus<Status extends WorkflowRunStatus>(
		status: Status,
		options?: WorkflowRunWaitOptions<boolean, boolean>
	): Promise<WorkflowRunWaitResultSuccess<Status, Output> | WorkflowRunWaitResult<Status, Output, boolean, boolean>> {
		if (options?.abortSignal?.aborted) {
			throw new Error("Status wait operation aborted");
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

		const shouldRetryOnResult = (state: WorkflowRunState<Output>) => Promise.resolve(state.status !== status);

		if (!Number.isFinite(maxAttempts) && options?.abortSignal === undefined) {
			const maybeResult = await withRetry(loadState, retryStrategy, { shouldRetryOnResult }).run();

			if (maybeResult.state === "timeout") {
				throw new Error("Something's wrong, this should've never timed out");
			}
			return maybeResult.result as WorkflowRunWaitResultSuccess<Status, Output>;
		}

		const maybeResult = options?.abortSignal
			? await withRetry(loadState, retryStrategy, {
					abortSignal: options.abortSignal,
					shouldRetryOnResult,
				}).run()
			: await withRetry(loadState, retryStrategy, { shouldRetryOnResult }).run();

		if (maybeResult.state === "completed") {
			return {
				success: true,
				state: maybeResult.result as WorkflowRunWaitResultSuccess<Status, Output>,
			};
		}
		return { success: false, cause: maybeResult.state };
	}

	public async cancel(reason?: string): Promise<void> {
		return this.transitionState({ status: "cancelled", reason });
	}

	public async pause(): Promise<void> {
		return this.transitionState({ status: "paused" });
	}

	public async resume(): Promise<void> {
		return this.transitionState({ status: "scheduled", scheduledInMs: 0, reason: "resume" });
	}

	private async transitionState(targetState: WorkflowRunStateRequest): Promise<void> {
		if (
			(targetState.status === "scheduled" && (targetState.reason === "new" || targetState.reason === "resume")) ||
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
	}

	private async transitionTaskState(taskPath: TaskPath, taskState: TaskStateRequest): Promise<void> {
		const { run } = await this.api.workflowRun.transitionTaskStateV1({
			id: this.run.id,
			taskPath,
			taskState,
			expectedRevision: this.run.revision,
		});
		this._run = run as WorkflowRun<Input, Output>;
	}

	private assertExecutionAllowed() {
		const status = this.run.state.status;
		if (status !== "queued" && status !== "running") {
			throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, status);
		}
	}
}
