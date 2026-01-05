import { isNonEmptyArray } from "@aikirun/lib/array";
import { sha256 } from "@aikirun/lib/crypto";
import { createSerializableError } from "@aikirun/lib/error";
import { stableStringify } from "@aikirun/lib/json";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import { getRetryParams, type RetryStrategy } from "@aikirun/lib/retry";
import type { Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { TaskFailedError } from "@aikirun/types/task";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	type ChildWorkflowRunInfo,
	type WorkflowOptions,
	type WorkflowReferenceOptions,
	type WorkflowRun,
	WorkflowRunFailedError,
	type WorkflowRunId,
	type WorkflowRunPath,
	type WorkflowRunStateFailed,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";
import type { WorkflowRunStateAwaitingRetryRequest } from "@aikirun/types/workflow-run-api";

import type { WorkflowRunContext } from "./run/context";
import { createEventMulticasters, type EventMulticasters, type EventsDefinition } from "./run/event";
import { type WorkflowRunHandle, workflowRunHandle } from "./run/handle";
import { type ChildWorkflowRunHandle, childWorkflowRunHandle } from "./run/handle-child";

export interface WorkflowVersionParams<Input, Output, AppContext, TEventsDefinition extends EventsDefinition> {
	handler: (
		run: Readonly<WorkflowRunContext<Input, AppContext, TEventsDefinition>>,
		input: Input,
		context: AppContext
	) => Promise<Output>;
	events?: TEventsDefinition;
	opts?: WorkflowOptions;
}

export interface WorkflowBuilder<Input, Output, AppContext, TEventsDefinition extends EventsDefinition> {
	opt<Path extends PathFromObject<WorkflowOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowOptions, Path>
	): WorkflowBuilder<Input, Output, AppContext, TEventsDefinition>;

	start: WorkflowVersion<Input, Output, AppContext, TEventsDefinition>["start"];

	startAsChild: WorkflowVersion<Input, Output, AppContext, TEventsDefinition>["startAsChild"];
}

export interface WorkflowVersion<
	Input,
	Output,
	AppContext,
	TEventsDefinition extends EventsDefinition = EventsDefinition,
> {
	name: WorkflowName;
	versionId: WorkflowVersionId;
	events: EventMulticasters<TEventsDefinition>;

	with(): WorkflowBuilder<Input, Output, AppContext, TEventsDefinition>;

	start: (
		client: Client<AppContext>,
		...args: Input extends void ? [] : [Input]
	) => Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>>;

	startAsChild: <ParentInput, ParentEventsDefinition extends EventsDefinition>(
		parentRun: WorkflowRunContext<ParentInput, AppContext, ParentEventsDefinition>,
		...args: Input extends void ? [] : [Input]
	) => Promise<ChildWorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>>;

	getHandle: (
		client: Client<AppContext>,
		runId: WorkflowRunId
	) => Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>>;

	[INTERNAL]: {
		eventsDefinition: TEventsDefinition;
		handler: (
			run: WorkflowRunContext<Input, AppContext, TEventsDefinition>,
			input: Input,
			context: AppContext
		) => Promise<void>;
	};
}

export class WorkflowVersionImpl<Input, Output, AppContext, TEventsDefinition extends EventsDefinition>
	implements WorkflowVersion<Input, Output, AppContext, TEventsDefinition>
{
	public readonly events: EventMulticasters<TEventsDefinition>;
	public readonly [INTERNAL]: WorkflowVersion<Input, Output, AppContext, TEventsDefinition>[typeof INTERNAL];

	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Input, Output, AppContext, TEventsDefinition>
	) {
		const eventsDefinition = this.params.events ?? ({} as TEventsDefinition);
		this.events = createEventMulticasters(eventsDefinition);
		this[INTERNAL] = {
			eventsDefinition,
			handler: this.handler.bind(this),
		};
	}

	public with(): WorkflowBuilder<Input, Output, AppContext, TEventsDefinition> {
		const optsOverrider = objectOverrider(this.params.opts ?? {});

		const createBuilder = (
			optsBuilder: ReturnType<typeof optsOverrider>
		): WorkflowBuilder<Input, Output, AppContext, TEventsDefinition> => {
			return {
				opt: (path, value) => createBuilder(optsBuilder.with(path, value)),

				start: (client, ...args) =>
					new WorkflowVersionImpl(this.name, this.versionId, {
						...this.params,
						opts: optsBuilder.build(),
					}).start(client, ...args),

				startAsChild: (parentRun, ...args) =>
					new WorkflowVersionImpl(this.name, this.versionId, {
						...this.params,
						opts: optsBuilder.build(),
					}).startAsChild(parentRun, ...args),
			};
		};

		return createBuilder(optsOverrider());
	}

	public async start(
		client: Client<AppContext>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		const { run } = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input: isNonEmptyArray(args) ? args[0] : undefined,
			options: this.params.opts,
		});
		return workflowRunHandle(client, run as WorkflowRun<Input, Output>, this[INTERNAL].eventsDefinition);
	}

	public async startAsChild(
		parentRun: WorkflowRunContext<unknown, AppContext, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		const parentRunHandle = parentRun[INTERNAL].handle;
		parentRunHandle[INTERNAL].assertExecutionAllowed();

		const { client } = parentRunHandle[INTERNAL];

		const input = isNonEmptyArray(args) ? args[0] : (undefined as Input);
		const inputHash = await sha256(stableStringify(input));

		const reference = this.params.opts?.reference;
		const path = await this.getPath(inputHash, reference);
		const existingRunInfo = parentRunHandle.run.childWorkflowRuns[path];
		if (existingRunInfo) {
			await this.assertUniqueChildRunReferenceId(
				parentRunHandle,
				existingRunInfo,
				inputHash,
				reference,
				parentRun.logger
			);

			const { run: existingRun } = await client.api.workflowRun.getByIdV1({ id: existingRunInfo.id });

			const logger = parentRun.logger.child({
				"aiki.childWorkflowName": existingRun.name,
				"aiki.childWorkflowVersionId": existingRun.versionId,
				"aiki.childWorkflowRunId": existingRun.id,
			});

			return childWorkflowRunHandle(
				client,
				path,
				existingRun as WorkflowRun<Input, Output>,
				parentRun,
				logger,
				this[INTERNAL].eventsDefinition
			);
		}

		const { run: newRun } = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input,
			path,
			parentWorkflowRunId: parentRun.id,
			options: this.params.opts,
		});
		parentRunHandle.run.childWorkflowRuns[path] = {
			id: newRun.id,
			inputHash,
			statusWaitResults: [],
		};

		const logger = parentRun.logger.child({
			"aiki.childWorkflowNamew": newRun.name,
			"aiki.childWorkflowVersionId": newRun.versionId,
			"aiki.childWorkflowRunId": newRun.id,
		});

		return childWorkflowRunHandle(
			client,
			path,
			newRun as WorkflowRun<Input, Output>,
			parentRun,
			logger,
			this[INTERNAL].eventsDefinition
		);
	}

	private async assertUniqueChildRunReferenceId(
		parentRunHandle: WorkflowRunHandle<unknown, unknown, AppContext, EventsDefinition>,
		existingRunInfo: ChildWorkflowRunInfo,
		inputHash: string,
		reference: WorkflowReferenceOptions | undefined,
		logger: Logger
	) {
		if (existingRunInfo.inputHash !== inputHash && reference) {
			const onConflict = reference.onConflict ?? "error";
			if (onConflict !== "error") {
				return;
			}
			logger.error("Reference ID already used by another child workflow", {
				"aiki.referenceId": reference.id,
				"aiki.existingChildWorkflowRunId": existingRunInfo.id,
			});
			const error = new WorkflowRunFailedError(
				parentRunHandle.run.id as WorkflowRunId,
				parentRunHandle.run.attempts,
				`Reference ID "${reference.id}" already used by another child workflow run ${existingRunInfo.id}`
			);
			await parentRunHandle[INTERNAL].transitionState({
				status: "failed",
				cause: "self",
				error: createSerializableError(error),
			});
			throw error;
		}
	}

	public async getHandle(
		client: Client<AppContext>,
		runId: WorkflowRunId
	): Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		return workflowRunHandle(client, runId, this[INTERNAL].eventsDefinition);
	}

	private async handler(
		run: WorkflowRunContext<Input, AppContext, TEventsDefinition>,
		input: Input,
		context: AppContext
	): Promise<void> {
		const { logger } = run;
		const { handle } = run[INTERNAL];

		handle[INTERNAL].assertExecutionAllowed();

		const retryStrategy = this.params.opts?.retry ?? { type: "never" };
		const state = handle.run.state;
		if (state.status === "queued" && state.reason === "retry") {
			await this.assertRetryAllowed(handle, retryStrategy, logger);
		}

		logger.info("Starting workflow");
		await handle[INTERNAL].transitionState({ status: "running" });

		const output = await this.tryExecuteWorkflow(input, run, context, retryStrategy);

		await handle[INTERNAL].transitionState({ status: "completed", output });
		logger.info("Workflow complete");
	}

	private async tryExecuteWorkflow(
		input: Input,
		run: WorkflowRunContext<Input, AppContext, TEventsDefinition>,
		context: AppContext,
		retryStrategy: RetryStrategy
	): Promise<Output> {
		while (true) {
			try {
				return await this.params.handler(run, input, context);
			} catch (error) {
				if (error instanceof WorkflowRunSuspendedError || error instanceof WorkflowRunFailedError) {
					throw error;
				}

				const { handle } = run[INTERNAL];

				const attempts = handle.run.attempts;
				const retryParams = getRetryParams(attempts, retryStrategy);

				if (!retryParams.retriesLeft) {
					const failedState = this.createFailedState(error);
					await handle[INTERNAL].transitionState(failedState);

					const logMeta: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(failedState)) {
						logMeta[`aiki.${key}`] = value;
					}
					run.logger.error("Workflow failed", {
						"aiki.attempts": attempts,
						...logMeta,
					});
					throw new WorkflowRunFailedError(run.id, attempts);
				}

				const awaitingRetryState = this.createAwaitingRetryState(error, retryParams.delayMs);
				await handle[INTERNAL].transitionState(awaitingRetryState);

				const logMeta: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(awaitingRetryState)) {
					logMeta[`aiki.${key}`] = value;
				}
				run.logger.info("Workflow failed. Awaiting retry", {
					"aiki.attempts": attempts,
					"aiki.delayMs": retryParams.delayMs,
					...logMeta,
				});

				// TODO: if delay is small enough, it might be more profitable to spin
				// Spinning should not reload workflow state or transition to awaiting retry
				// If the workflow failed
				throw new WorkflowRunSuspendedError(run.id);
			}
		}
	}

	private async assertRetryAllowed(
		handle: WorkflowRunHandle<Input, unknown, AppContext, TEventsDefinition>,
		retryStrategy: RetryStrategy,
		logger: Logger
	): Promise<void> {
		const { id, attempts } = handle.run;

		const retryParams = getRetryParams(attempts, retryStrategy);

		if (!retryParams.retriesLeft) {
			logger.error("Workflow retry not allowed", { "aiki.attempts": attempts });

			const error = new WorkflowRunFailedError(id as WorkflowRunId, attempts);
			await handle[INTERNAL].transitionState({
				status: "failed",
				cause: "self",
				error: createSerializableError(error),
			});

			throw error;
		}
	}

	private createFailedState(error: unknown): WorkflowRunStateFailed {
		if (error instanceof TaskFailedError) {
			return {
				status: "failed",
				cause: "task",
				taskPath: error.taskPath,
			};
		}

		return {
			status: "failed",
			cause: "self",
			error: createSerializableError(error),
		};
	}

	private createAwaitingRetryState(error: unknown, nextAttemptInMs: number): WorkflowRunStateAwaitingRetryRequest {
		if (error instanceof TaskFailedError) {
			return {
				status: "awaiting_retry",
				cause: "task",
				nextAttemptInMs,
				taskPath: error.taskPath,
			};
		}

		return {
			status: "awaiting_retry",
			cause: "self",
			nextAttemptInMs,
			error: createSerializableError(error),
		};
	}

	private async getPath(inputHash: string, reference: WorkflowReferenceOptions | undefined): Promise<WorkflowRunPath> {
		const path = reference
			? `${this.name}/${this.versionId}/${reference.id}`
			: `${this.name}/${this.versionId}/${inputHash}`;
		return path as WorkflowRunPath;
	}
}
