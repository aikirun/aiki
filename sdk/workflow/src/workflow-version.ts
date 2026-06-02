import { getWorkflowRunAddress } from "@aikirun/lib/address";
import { hashInput } from "@aikirun/lib/crypto";
import type { Logger } from "@aikirun/lib/logger";
import {
	type ObjectBuilder,
	objectOverrider,
	type PathFromObject,
	type RequireAtLeastOneProp,
	type TypeOfValueAtPath,
} from "@aikirun/lib/object";
import type { RetryStrategy } from "@aikirun/lib/retry";
import { getRetryParams } from "@aikirun/lib/retry";
import { createSerializableError } from "@aikirun/lib/serializable";
import type { WorkflowRunStateAwaitingRetryRequest } from "@aikirun/types/api/workflow-run";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type {
	ReplayManifest,
	WorkflowDefinitionOptions,
	WorkflowRunAddress,
	WorkflowRunId,
	WorkflowRunRecord,
	WorkflowRunStateFailed,
	WorkflowStartOptions,
} from "@aikirun/types/workflow/run";
import {
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import { TaskFailedError } from "@aikirun/types/workflow/task";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { WorkflowRun } from "./run";
import { createEventMulticasters, type EventMulticasters, type EventsDefinition } from "./run/event";
import { type WorkflowRunHandle, workflowRunHandle } from "./run/handle";
import { type ChildWorkflowRunHandle, childWorkflowRunHandle } from "./run/handle-child";

export interface WorkflowVersionParams<Input, Output, Context, TEvents extends EventsDefinition> {
	handler: (run: Readonly<WorkflowRun<Input, Context, TEvents>>, input: Input) => Promise<Output>;
	events?: TEvents;
	options?: WorkflowDefinitionOptions;
	schema?: RequireAtLeastOneProp<{
		input?: StandardSchemaV1<Input>;
		output?: StandardSchemaV1<Output>;
	}>;
}

export interface WorkflowVersion<Input, Output, Context, TEvents extends EventsDefinition = EventsDefinition> {
	name: WorkflowName;
	versionId: WorkflowVersionId;
	events: EventMulticasters<TEvents>;

	with(): WorkflowBuilder<Input, Output, Context, TEvents>;

	start(
		client: Client<Context>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>>;

	startAsChild<ParentInput, ParentEvents extends EventsDefinition>(
		parentRun: WorkflowRun<ParentInput, Context, ParentEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, Context, TEvents>>;

	getHandleById(client: Client<Context>, runId: string): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>>;

	getHandleByReferenceId(
		client: Client<Context>,
		referenceId: string
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>>;

	[INTERNAL]: {
		eventsDefinition: TEvents;
		handler: (run: WorkflowRun<Input, Context, TEvents>, input: Input) => Promise<void>;
	};
}

// biome-ignore lint/suspicious/noExplicitAny: I want any workflow
export type AnyWorkflowVersion = WorkflowVersion<any, any, any, any>;

export type UnknownWorkflowVersion = WorkflowVersion<unknown, unknown, unknown>;

export class WorkflowVersionImpl<Input, Output, Context, TEvents extends EventsDefinition>
	implements WorkflowVersion<Input, Output, Context, TEvents>
{
	public readonly events: EventMulticasters<TEvents>;
	public readonly [INTERNAL]: WorkflowVersion<Input, Output, Context, TEvents>[typeof INTERNAL];

	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Input, Output, Context, TEvents>
	) {
		const eventsDefinition = this.params.events ?? ({} as TEvents);
		this.events = createEventMulticasters(this.name, this.versionId, eventsDefinition);
		this[INTERNAL] = {
			eventsDefinition,
			handler: this.handler.bind(this),
		};
	}

	public with(): WorkflowBuilder<Input, Output, Context, TEvents> {
		const startOptions: WorkflowStartOptions = this.params.options ?? {};
		const startOptionsOverrider = objectOverrider(startOptions);
		return new WorkflowBuilderImpl(this, startOptionsOverrider());
	}

	public async start(
		client: Client<Context>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>> {
		return this.startWithOptions(client, this.params.options ?? {}, ...args);
	}

	public async startWithOptions(
		client: Client<Context>,
		startOptions: WorkflowStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>> {
		let input = args[0];
		const schema = this.params.schema?.input;
		if (schema) {
			const schemaValidation = schema["~standard"].validate(input);
			const schemaValidationResult = schemaValidation instanceof Promise ? await schemaValidation : schemaValidation;
			if (schemaValidationResult.issues) {
				client.logger.error("Invalid workflow data", { "aiki.issues": schemaValidationResult.issues });
				throw new SchemaValidationError("Invalid workflow data", schemaValidationResult.issues);
			}
			input = schemaValidationResult.value;
		}

		const { id } = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input,
			options: startOptions,
		});

		client.logger.info("Created workflow", {
			"aiki.workflowName": this.name,
			"aiki.workflowVersionId": this.versionId,
			"aiki.workflowRunId": id,
		});

		return workflowRunHandle(client, id as WorkflowRunId, this[INTERNAL].eventsDefinition);
	}

	public async startAsChild(
		parentRun: WorkflowRun<unknown, Context, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, Context, TEvents>> {
		return this.startAsChildWithOptions(parentRun, this.params.options ?? {}, ...args);
	}

	public async startAsChildWithOptions(
		parentRun: WorkflowRun<unknown, Context, EventsDefinition>,
		startOptions: WorkflowStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, Context, TEvents>> {
		const parentRunHandle = parentRun[INTERNAL].handle;
		parentRunHandle[INTERNAL].assertExecutionAllowed();

		const { client } = parentRunHandle[INTERNAL];

		const inputRaw = args[0];
		const input = await this.parse(parentRunHandle, this.params.schema?.input, inputRaw, parentRun.logger);
		const inputHash = await hashInput(input);

		const referenceId = startOptions.reference?.id;
		const address = getWorkflowRunAddress(this.name, this.versionId, referenceId ?? inputHash) as WorkflowRunAddress;
		const replayManifest = parentRun[INTERNAL].replayManifest;

		if (replayManifest.hasUnconsumedEntries()) {
			const existingRunInfo = replayManifest.consumeNextChildWorkflowRun(address);
			if (existingRunInfo) {
				const { run: existingRun } = await client.api.workflowRun.getByIdV1({ id: existingRunInfo.id });
				if (existingRun.state.status === "completed") {
					await this.parse(parentRunHandle, this.params.schema?.output, existingRun.state.output, parentRun.logger);
				}

				const logger = parentRun.logger.child({
					"aiki.childWorkflowName": existingRun.name,
					"aiki.childWorkflowVersionId": existingRun.versionId,
					"aiki.childWorkflowRunId": existingRun.id,
				});

				return childWorkflowRunHandle(
					client,
					existingRun as WorkflowRunRecord<Input, Output>,
					parentRun[INTERNAL].handle,
					existingRunInfo.childWorkflowRunWaitQueues,
					logger,
					this[INTERNAL].eventsDefinition
				);
			}

			await this.throwNonDeterminismError(parentRun, parentRunHandle, inputHash, referenceId, replayManifest);
		}

		const shard = parentRun.options.shard;
		const { id: newRunId } = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input,
			parentWorkflowRunId: parentRun.id,
			options: shard === undefined ? startOptions : { ...startOptions, shard },
		});
		const { run: newRun } = await client.api.workflowRun.getByIdV1({ id: newRunId });

		const logger = parentRun.logger.child({
			"aiki.childWorkflowName": newRun.name,
			"aiki.childWorkflowVersionId": newRun.versionId,
			"aiki.childWorkflowRunId": newRun.id,
		});

		logger.info("Created child workflow");

		return childWorkflowRunHandle(
			client,
			newRun as WorkflowRunRecord<Input, Output>,
			parentRun[INTERNAL].handle,
			{
				cancelled: { childWorkflowRunWaits: [] },
				completed: { childWorkflowRunWaits: [] },
				failed: { childWorkflowRunWaits: [] },
			},
			logger,
			this[INTERNAL].eventsDefinition
		);
	}

	private async throwNonDeterminismError(
		parentRun: WorkflowRun<unknown, Context, EventsDefinition>,
		parentRunHandle: WorkflowRunHandle<unknown, unknown, Context, EventsDefinition>,
		inputHash: string,
		referenceId: string | undefined,
		manifest: ReplayManifest
	): Promise<never> {
		const unconsumedManifestEntries = manifest.getUnconsumedEntries();

		const logMeta: Record<string, unknown> = {
			"aiki.workflowName": this.name,
			"aiki.inputHash": inputHash,
			"aiki.unconsumedManifestEntries": unconsumedManifestEntries,
		};
		if (referenceId !== undefined) {
			logMeta["aiki.referenceId"] = referenceId;
		}
		parentRun.logger.error("Replay divergence", logMeta);

		const error = new NonDeterminismError(parentRun.id, parentRunHandle.run.attempts, unconsumedManifestEntries);
		await parentRunHandle[INTERNAL].transitionState({
			status: "failed",
			cause: "self",
			error: createSerializableError(error),
		});
		throw error;
	}

	public async getHandleById(
		client: Client<Context>,
		runId: string
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>> {
		return workflowRunHandle(client, runId as WorkflowRunId, this[INTERNAL].eventsDefinition);
	}

	public async getHandleByReferenceId(
		client: Client<Context>,
		referenceId: string
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>> {
		const { run } = await client.api.workflowRun.getByReferenceIdV1({
			name: this.name,
			versionId: this.versionId,
			referenceId,
		});
		return workflowRunHandle(client, run as WorkflowRunRecord<Input, Output>, this[INTERNAL].eventsDefinition);
	}

	private async handler(run: WorkflowRun<Input, Context, TEvents>, input: Input): Promise<void> {
		const { logger } = run;
		const { handle } = run[INTERNAL];

		handle[INTERNAL].assertExecutionAllowed();

		const retryStrategy = this.params.options?.retry ?? { type: "never" };

		logger.info("Starting workflow");
		await handle[INTERNAL].transitionState({ status: "running" });

		const output = await this.tryExecuteWorkflow(input, run, retryStrategy);

		await handle[INTERNAL].transitionState({ status: "completed", output });
		logger.info("Workflow complete");
	}

	private async tryExecuteWorkflow(
		input: Input,
		run: WorkflowRun<Input, Context, TEvents>,
		retryStrategy: RetryStrategy
	): Promise<Output> {
		const { handle } = run[INTERNAL];

		while (true) {
			try {
				const outputRaw = await this.params.handler(run, input);
				const output = await this.parse(handle, this.params.schema?.output, outputRaw, run.logger);
				return output;
			} catch (error) {
				if (
					error instanceof WorkflowRunSuspendedError ||
					error instanceof WorkflowRunFailedError ||
					error instanceof WorkflowRunRevisionConflictError ||
					error instanceof NonDeterminismError
				) {
					throw error;
				}

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
				run.logger.info("Workflow awaiting retry", {
					"aiki.attempts": attempts,
					...logMeta,
				});

				// TODO: if delay is small enough, it might be more profitable to spin
				// Spinning should not reload workflow state or transition to awaiting retry
				// If the workflow failed
				throw new WorkflowRunSuspendedError(run.id);
			}
		}
	}

	private async parse<T>(
		handle: WorkflowRunHandle<unknown, unknown, unknown, EventsDefinition>,
		schema: StandardSchemaV1<T> | undefined,
		data: unknown,
		logger: Logger
	): Promise<T> {
		if (!schema) {
			return data as T;
		}

		const schemaValidation = schema["~standard"].validate(data);
		const schemaValidationResult = schemaValidation instanceof Promise ? await schemaValidation : schemaValidation;
		if (!schemaValidationResult.issues) {
			return schemaValidationResult.value;
		}

		logger.error("Invalid workflow data", { "aiki.issues": schemaValidationResult.issues });
		await handle[INTERNAL].transitionState({
			status: "failed",
			cause: "self",
			error: {
				name: "SchemaValidationError",
				message: JSON.stringify(schemaValidationResult.issues),
			},
		});
		throw new WorkflowRunFailedError(handle.run.id as WorkflowRunId, handle.run.attempts);
	}

	private createFailedState(error: unknown): WorkflowRunStateFailed {
		if (error instanceof TaskFailedError) {
			return {
				status: "failed",
				cause: "task",
				taskId: error.taskId,
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
				taskId: error.taskId,
			};
		}

		return {
			status: "awaiting_retry",
			cause: "self",
			nextAttemptInMs,
			error: createSerializableError(error),
		};
	}
}

export interface WorkflowBuilder<Input, Output, Context, TEvents extends EventsDefinition> {
	opt<Path extends PathFromObject<WorkflowStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowStartOptions, Path>
	): WorkflowBuilder<Input, Output, Context, TEvents>;

	start(
		client: Client<Context>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>>;

	startAsChild<ParentInput, ParentEvents extends EventsDefinition>(
		parentRun: WorkflowRun<ParentInput, Context, ParentEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, Context, TEvents>>;
}

class WorkflowBuilderImpl<Input, Output, Context, TEvents extends EventsDefinition>
	implements WorkflowBuilder<Input, Output, Context, TEvents>
{
	constructor(
		private readonly workflow: WorkflowVersionImpl<Input, Output, Context, TEvents>,
		private readonly startOptionsBuilder: ObjectBuilder<WorkflowStartOptions>
	) {}

	opt<Path extends PathFromObject<WorkflowStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowStartOptions, Path>
	): WorkflowBuilder<Input, Output, Context, TEvents> {
		return new WorkflowBuilderImpl(this.workflow, this.startOptionsBuilder.with(path, value));
	}

	start(
		client: Client<Context>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, Context, TEvents>> {
		return this.workflow.startWithOptions(client, this.startOptionsBuilder.build(), ...args);
	}

	startAsChild<ParentInput, ParentEvents extends EventsDefinition>(
		parentRun: WorkflowRun<ParentInput, Context, ParentEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, Context, TEvents>> {
		return this.workflow.startAsChildWithOptions(parentRun, this.startOptionsBuilder.build(), ...args);
	}
}
