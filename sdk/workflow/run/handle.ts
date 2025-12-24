import { withRetry } from "@aikirun/lib";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { TaskPath } from "@aikirun/types/task";
import {
	type WorkflowRun,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	type WorkflowRunState,
	type WorkflowRunStateCompleted,
	type WorkflowRunStateInComplete,
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

	wait<S extends WorkflowRunStatus>(
		condition: { type: "status"; status: S },
		options: WorkflowRunWaitOptions
	): Promise<
		| { success: false; cause: "timeout" | "aborted" }
		| {
				success: true;
				state: S extends "completed" ? WorkflowRunStateCompleted<Output> : WorkflowRunStateInComplete;
		  }
	>;
	wait(
		condition: { type: "event"; event: string },
		options: WorkflowRunWaitOptions
	): Promise<{ success: false; cause: "timeout" | "aborted" } | { success: true; state: WorkflowRunState<Output> }>;

	cancel: (reason?: string) => Promise<void>;

	pause: () => Promise<void>;

	resume: () => Promise<void>;

	[INTERNAL]: {
		transitionState: (state: WorkflowRunStateRequest) => Promise<void>;
		transitionTaskState: (taskPath: TaskPath, taskState: TaskStateRequest) => Promise<void>;
		assertExecutionAllowed: () => void;
	};
}

export interface WorkflowRunWaitOptions {
	maxDurationMs: number;
	pollIntervalMs?: number;
	abortSignal?: AbortSignal;
}

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

	// TODO: instead polling the current state, use the transition history
	// because it is entirely possible for a workflow to flash though a state
	// and the handle will never know that the workflow hit that state
	public async wait<
		S extends WorkflowRunStatus,
		R extends S extends "completed" ? WorkflowRunStateCompleted<Output> : WorkflowRunStateInComplete,
	>(
		condition: { type: "status"; status: S } | { type: "event"; event: string },
		options: WorkflowRunWaitOptions
	): Promise<{ success: false; cause: "timeout" | "aborted" } | { success: true; state: R }> {
		if (options.abortSignal?.aborted) {
			throw new Error("Wait operation aborted");
		}

		const delayMs = options.pollIntervalMs ?? 1_000;
		const maxAttempts = Math.ceil(options.maxDurationMs / delayMs);

		switch (condition.type) {
			case "status": {
				if (options.abortSignal !== undefined) {
					const maybeResult = await withRetry(
						async () => {
							await this.refresh();
							return this.run.state;
						},
						{ type: "fixed", maxAttempts, delayMs },
						{
							abortSignal: options.abortSignal,
							shouldRetryOnResult: (state) => Promise.resolve(state.status !== condition.status),
						}
					).run();
					if (maybeResult.state === "timeout" || maybeResult.state === "aborted") {
						return { success: false, cause: maybeResult.state };
					}
					return {
						success: true,
						state: maybeResult.result as R,
					};
				}

				const maybeResult = await withRetry(
					async () => {
						await this.refresh();
						return this.run.state;
					},
					{ type: "fixed", maxAttempts, delayMs },
					{ shouldRetryOnResult: (state) => Promise.resolve(state.status !== condition.status) }
				).run();
				if (maybeResult.state === "timeout") {
					return { success: false, cause: maybeResult.state };
				}
				return {
					success: true,
					state: maybeResult.result as R,
				};
			}
			case "event": {
				throw new Error("Event-based waiting is not yet implemented");
			}
			default:
				return condition satisfies never;
		}
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
