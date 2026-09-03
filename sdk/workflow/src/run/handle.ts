import { delay } from "@aikirun/lib/async";
import type { DurationObject } from "@aikirun/lib/duration";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import type { DistributiveOmit } from "@aikirun/lib/object";
import type { TaskTransitionStateRequestV1 } from "@aikirun/types/api/task";
import type { WorkflowRunStateRequest, WorkflowRunTransitionStateResponseV1 } from "@aikirun/types/api/workflow-run";
import type { ApiClient, Client } from "@aikirun/types/client";
import type { Codec } from "@aikirun/types/infra/codec";
import { INTERNAL } from "@aikirun/types/symbols";
import type {
	TerminalWorkflowRunState,
	WorkflowRunId,
	WorkflowRunRecord,
	WorkflowRunState,
} from "@aikirun/types/workflow/run";
import { WorkflowRunNotExecutableError, WorkflowRunRevisionConflictError } from "@aikirun/types/workflow/run";
import type { TaskInfo } from "@aikirun/types/workflow/task";

import { createEventSenders, type EventSenders, type EventsDefinition } from "./event";

const noopCodec: Codec = {
	encode: async (payload) => payload,
	decode: async (payload) => payload,
};

export function workflowRunHandle<Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	id: WorkflowRunId,
	eventsDefinition?: TEvents,
	logger?: Logger
): Promise<WorkflowRunHandle<Output, Context, TEvents>>;

export function workflowRunHandle<Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	run: WorkflowRunRecord,
	eventsDefinition?: TEvents,
	logger?: Logger
): WorkflowRunHandle<Output, Context, TEvents>;

export function workflowRunHandle<Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	runOrId: WorkflowRunId | WorkflowRunRecord,
	eventsDefinition?: TEvents,
	logger?: Logger
): WorkflowRunHandle<Output, Context, TEvents> | Promise<WorkflowRunHandle<Output, Context, TEvents>> {
	if (typeof runOrId === "string") {
		const runId = runOrId;
		return (async () => {
			const run = (await client.api.workflowRun.getByIdV1({ id: runId })).run as WorkflowRunRecord;
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

export interface WorkflowRunHandle<Output, Context, TEvents extends EventsDefinition = EventsDefinition> {
	run: Readonly<WorkflowRunRecord>;

	events: EventSenders<TEvents>;

	refresh: () => Promise<void>;

	/**
	 * Waits for the workflow run to reach a terminal status by polling.
	 *
	 * Any terminal status (`completed`, `failed`, or `cancelled`) resolves the wait.
	 *
	 * Returns a result object:
	 * - `{ success: true, state }` - the run reached a terminal status; `state.status` says which
	 * - `{ success: false, cause: "timeout" }` - the wall-clock timeout elapsed (only when a
	 *   timeout option is provided); a final poll happens at the deadline before the wait gives up
	 * - `{ success: false, cause: "aborted" }` - the abort signal triggered (only when a signal
	 *   option is provided)
	 *
	 * @param options - Optional configuration for polling interval, timeout, and abort signal
	 *
	 * @example
	 * // Wait indefinitely until the run terminates
	 * const result = await handle.wait();
	 * if (result.state.status === "completed") {
	 *   console.log(result.state.output);
	 * } else {
	 *   console.log(`Run ended ${result.state.status}`);
	 * }
	 *
	 * @example
	 * // Wait with a timeout
	 * const result = await handle.wait({ timeout: { seconds: 30 } });
	 * if (!result.success) {
	 *   console.log("Timed out waiting for the run");
	 * } else if (result.state.status === "completed") {
	 *   console.log(result.state.output);
	 * }
	 *
	 * @example
	 * // Wait with an abort signal
	 * const controller = new AbortController();
	 * const result = await handle.wait({ signal: controller.signal });
	 * if (!result.success) {
	 *   console.log(`Wait ended: ${result.cause}`);
	 * }
	 */
	wait(options?: WorkflowRunWaitOptions<false, false>): Promise<WorkflowRunWaitResult<Output, false, false>>;
	wait(options: WorkflowRunWaitOptions<true, false>): Promise<WorkflowRunWaitResult<Output, true, false>>;
	wait(options: WorkflowRunWaitOptions<false, true>): Promise<WorkflowRunWaitResult<Output, false, true>>;
	wait(options: WorkflowRunWaitOptions<true, true>): Promise<WorkflowRunWaitResult<Output, true, true>>;

	cancel: (explanation?: string) => Promise<void>;

	pause: () => Promise<void>;

	resume: () => Promise<void>;

	wakeup: () => Promise<void>;

	[INTERNAL]: {
		client: Client<Context>;
		codec: Codec;
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

export type WorkflowRunWaitResultSuccess<Output> =
	| Extract<TerminalWorkflowRunState, { status: "cancelled" | "failed" }>
	| { status: "completed"; output: Output };

export type WorkflowRunWaitResult<Output, Timed extends boolean, Abortable extends boolean> = [
	Timed,
	Abortable,
] extends [false, false]
	? {
			success: true;
			state: WorkflowRunWaitResultSuccess<Output>;
		}
	:
			| {
					success: true;
					state: WorkflowRunWaitResultSuccess<Output>;
			  }
			| {
					success: false;
					cause: (Timed extends true ? "timeout" : never) | (Abortable extends true ? "aborted" : never);
			  };

export async function decodeWaitResultState<Output>(
	codec: Codec,
	state: TerminalWorkflowRunState
): Promise<WorkflowRunWaitResultSuccess<Output>> {
	if (state.status !== "completed") {
		return state;
	}

	return {
		status: "completed",
		output: (await codec.decode(state.output)) as Output,
	};
}

class WorkflowRunHandleImpl<Output, Context, TEvents extends EventsDefinition>
	implements WorkflowRunHandle<Output, Context, TEvents>
{
	private readonly api: ApiClient;
	public readonly events: EventSenders<TEvents>;
	public readonly [INTERNAL]: WorkflowRunHandle<Output, Context, TEvents>[typeof INTERNAL];

	constructor(
		client: Client<Context>,
		private _run: WorkflowRunRecord,
		eventsDefinition: TEvents,
		private readonly logger: Logger
	) {
		this.api = client.api;
		this.events = createEventSenders(client.api, this._run.id, eventsDefinition, this.logger);

		const codec = this._run.clientCodecApplied ? client[INTERNAL].codec : noopCodec;

		this[INTERNAL] = {
			client,
			codec,
			transitionState: this.transitionState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
			assertExecutionAllowed: this.assertExecutionAllowed.bind(this),
		};
	}

	public get run(): Readonly<WorkflowRunRecord> {
		return this._run;
	}

	public async refresh() {
		// TODO: when chunking is implemented, refresh should load only data after it's cursor
		const { run: currentRun } = await this.api.workflowRun.getByIdV1({ id: this.run.id });
		this._run = currentRun as WorkflowRunRecord;
	}

	public async wait(
		options?: WorkflowRunWaitOptions<false, false>
	): Promise<WorkflowRunWaitResult<Output, false, false>>;

	public async wait(options: WorkflowRunWaitOptions<true, false>): Promise<WorkflowRunWaitResult<Output, true, false>>;

	public async wait(options: WorkflowRunWaitOptions<false, true>): Promise<WorkflowRunWaitResult<Output, false, true>>;

	public async wait(options: WorkflowRunWaitOptions<true, true>): Promise<WorkflowRunWaitResult<Output, true, true>>;

	public async wait(
		options?: WorkflowRunWaitOptions<boolean, boolean>
	): Promise<WorkflowRunWaitResult<Output, boolean, boolean>> {
		return this.waitByPolling(options);
	}

	private async waitByPolling(
		options?: WorkflowRunWaitOptions<boolean, boolean>
	): Promise<WorkflowRunWaitResult<Output, boolean, boolean>> {
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
				// Terminal states have no exits, so a run reported terminated is terminated
				// forever: the refreshed state is a terminal state.
				await this.refresh();
				return {
					success: true,
					state: await decodeWaitResultState<Output>(this[INTERNAL].codec, this._run.state as TerminalWorkflowRunState),
				};
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
			} else if (targetState.status === "awaiting_event" || targetState.status === "awaiting_child_workflow") {
				response = await this.api.workflowRun.transitionStateV1({
					type: "optimistic",
					id: this.run.id,
					state: targetState,
					expectedRevision: this.run.revision,
					expectedSignalSequence: this.run.signalSequence,
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
			this._run.state = response.state as WorkflowRunState;
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
