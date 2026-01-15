import { isNonEmptyArray } from "@aikirun/lib/array";
import { hashInput } from "@aikirun/lib/crypto";
import { createSerializableError } from "@aikirun/lib/error";
import {
	type ObjectBuilder,
	objectOverrider,
	type PathFromObject,
	type RequireAtLeastOneProp,
	type TypeOfValueAtPath,
} from "@aikirun/lib/object";
import { getWorkflowRunPath } from "@aikirun/lib/path";
import { getRetryParams, type RetryStrategy } from "@aikirun/lib/retry";
import type { Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { TaskFailedError } from "@aikirun/types/task";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	type ChildWorkflowRunInfo,
	type WorkflowDefinitionOptions,
	type WorkflowReferenceOptions,
	type WorkflowRun,
	WorkflowRunConflictError,
	WorkflowRunFailedError,
	type WorkflowRunId,
	type WorkflowRunStateFailed,
	WorkflowRunSuspendedError,
	type WorkflowStartOptions,
} from "@aikirun/types/workflow-run";
import type { WorkflowRunStateAwaitingRetryRequest } from "@aikirun/types/workflow-run-api";
import type { StandardSchemaV1 } from "@standard-schema/spec";

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
	opts?: WorkflowDefinitionOptions;
	schema?: RequireAtLeastOneProp<{
		input?: StandardSchemaV1<Input>;
		output?: StandardSchemaV1<Output>;
	}>;
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

	getHandleById: (
		client: Client<AppContext>,
		runId: string
	) => Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>>;

	getHandleByReferenceId: (
		client: Client<AppContext>,
		referenceId: string
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
		this.events = createEventMulticasters(this.name, this.versionId, eventsDefinition);
		this[INTERNAL] = {
			eventsDefinition,
			handler: this.handler.bind(this),
		};
	}

	public with(): WorkflowBuilder<Input, Output, AppContext, TEventsDefinition> {
		const startOpts: WorkflowStartOptions = this.params.opts ?? {};
		const startOptsOverrider = objectOverrider(startOpts);
		return new WorkflowBuilderImpl(this, startOptsOverrider());
	}

	public async start(
		client: Client<AppContext>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		return this.startWithOpts(client, this.params.opts ?? {}, ...args);
	}

	public async startWithOpts(
		client: Client<AppContext>,
		startOpts: WorkflowStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		const inputRaw = isNonEmptyArray(args) ? args[0] : undefined;

		let input = inputRaw;
		const schema = this.params.schema?.input;
		if (schema) {
			const schemaValidation = schema["~standard"].validate(inputRaw);
			const schemaValidationResult = schemaValidation instanceof Promise ? await schemaValidation : schemaValidation;
			if (schemaValidationResult.issues) {
				client.logger.error("Invalid workflow data", { "aiki.issues": schemaValidationResult.issues });
				throw new SchemaValidationError("Invalid workflow data", schemaValidationResult.issues);
			}
			input = schemaValidationResult.value;
		}

		const { run } = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input,
			options: startOpts,
		});

		client.logger.info("Created workflow", {
			"aiki.workflowName": this.name,
			"aiki.workflowVersionId": this.versionId,
			"aiki.workflowRunId": run.id,
		});

		return workflowRunHandle(client, run as WorkflowRun<Input, Output>, this[INTERNAL].eventsDefinition);
	}

	public async startAsChild(
		parentRun: WorkflowRunContext<unknown, AppContext, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		return this.startAsChildWithOpts(parentRun, this.params.opts ?? {}, ...args);
	}

	public async startAsChildWithOpts(
		parentRun: WorkflowRunContext<unknown, AppContext, EventsDefinition>,
		startOpts: WorkflowStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		const parentRunHandle = parentRun[INTERNAL].handle;
		parentRunHandle[INTERNAL].assertExecutionAllowed();

		const { client } = parentRunHandle[INTERNAL];

		const inputRaw = isNonEmptyArray(args) ? args[0] : (undefined as Input);
		const input = await this.parse(parentRunHandle, this.params.schema?.input, inputRaw, parentRun.logger);
		const inputHash = await hashInput(input);

		const reference = startOpts.reference;
		const path = getWorkflowRunPath(this.name, this.versionId, reference?.id ?? inputHash);
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
			parentWorkflowRunId: parentRun.id,
			options: startOpts,
		});
		parentRunHandle.run.childWorkflowRuns[path] = {
			id: newRun.id,
			name: newRun.name,
			versionId: newRun.versionId,
			inputHash,
			statusWaitResults: [],
		};

		const logger = parentRun.logger.child({
			"aiki.childWorkflowName": newRun.name,
			"aiki.childWorkflowVersionId": newRun.versionId,
			"aiki.childWorkflowRunId": newRun.id,
		});

		logger.info("Created child workflow");

		return childWorkflowRunHandle(
			client,
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
			const conflictPolicy = reference.conflictPolicy ?? "error";
			if (conflictPolicy !== "error") {
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

	public async getHandleById(
		client: Client<AppContext>,
		runId: string
	): Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		return workflowRunHandle(client, runId as WorkflowRunId, this[INTERNAL].eventsDefinition);
	}

	public async getHandleByReferenceId(
		client: Client<AppContext>,
		referenceId: string
	): Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		const { run } = await client.api.workflowRun.getByReferenceIdV1({
			name: this.name,
			versionId: this.versionId,
			referenceId,
		});
		return workflowRunHandle(client, run as WorkflowRun<Input, Output>, this[INTERNAL].eventsDefinition);
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
		const { handle } = run[INTERNAL];

		while (true) {
			try {
				const outputRaw = await this.params.handler(run, input, context);
				const output = await this.parse(handle, this.params.schema?.output, outputRaw, run.logger);
				return output;
			} catch (error) {
				if (
					error instanceof WorkflowRunSuspendedError ||
					error instanceof WorkflowRunFailedError ||
					error instanceof WorkflowRunConflictError
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

export interface WorkflowBuilder<Input, Output, AppContext, TEventsDefinition extends EventsDefinition> {
	opt<Path extends PathFromObject<WorkflowStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowStartOptions, Path>
	): WorkflowBuilder<Input, Output, AppContext, TEventsDefinition>;

	start: WorkflowVersion<Input, Output, AppContext, TEventsDefinition>["start"];

	startAsChild: WorkflowVersion<Input, Output, AppContext, TEventsDefinition>["startAsChild"];
}

class WorkflowBuilderImpl<Input, Output, AppContext, TEventsDefinition extends EventsDefinition>
	implements WorkflowBuilder<Input, Output, AppContext, TEventsDefinition>
{
	constructor(
		private readonly workflow: WorkflowVersionImpl<Input, Output, AppContext, TEventsDefinition>,
		private readonly startOptsBuilder: ObjectBuilder<WorkflowStartOptions>
	) {}

	opt<Path extends PathFromObject<WorkflowStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowStartOptions, Path>
	): WorkflowBuilder<Input, Output, AppContext, TEventsDefinition> {
		return new WorkflowBuilderImpl(this.workflow, this.startOptsBuilder.with(path, value));
	}

	start(
		client: Client<AppContext>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		return this.workflow.startWithOpts(client, this.startOptsBuilder.build(), ...args);
	}

	startAsChild<ParentInput, ParentEventsDefinition extends EventsDefinition>(
		parentRun: WorkflowRunContext<ParentInput, AppContext, ParentEventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Input, Output, AppContext, TEventsDefinition>> {
		return this.workflow.startAsChildWithOpts(parentRun, this.startOptsBuilder.build(), ...args);
	}
}
