import { getCompositeId } from "@aikirun/lib/id";
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
	WorkflowRunAddress,
	WorkflowRunId,
	WorkflowRunOptions,
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
import { noopCodec, toBoundCodec } from "./run/bound-codec";
import { createEventMulticasters, type EventMulticasters, type EventsDefinition } from "./run/event";
import { isWorkflowRunRevisionConflictError, type WorkflowRunHandle, workflowRunHandle } from "./run/handle";
import { type ChildWorkflowRunHandle, childWorkflowRunHandle } from "./run/handle-child";
import { validateWithSchema } from "./run/schema-validation";

export interface WorkflowVersionParams<Input, Output, Context, TEvents extends EventsDefinition> {
	handler: (run: Readonly<WorkflowRun<Context, TEvents>>, input: Input) => Promise<Output>;
	events?: TEvents;
	retry?: RetryStrategy;
	schema?: RequireAtLeastOneProp<{
		input?: StandardSchemaV1<Input>;
		output?: StandardSchemaV1<Output>;
	}>;
}

export interface WorkflowVersion<Input, Output, Context, TEvents extends EventsDefinition = EventsDefinition> {
	name: WorkflowName;
	versionId: WorkflowVersionId;
	events: EventMulticasters<TEvents>;

	/**
	 * Sets one option and returns a copy. The original is unchanged.
	 *
	 * Which type comes back depends on what the option answers. `retry` answers "if this fails, try
	 * three more times"; `pool` answers "run on this kind of workers". Answers like those fit any
	 * run, so setting one — see {@link WorkflowRunOptions} — returns a {@link WorkflowVersion}, which
	 * you can go on starting as often as you like.
	 *
	 * `reference` answers "this particular run is order-123"; `trigger` answers "execute this particular run five minutes from now".
	 * Both are about one particular run, so setting one returns a {@link WorkflowVersionStart}:
	 * that single start, and nothing else. Anything that mints or executes many runs from one version
	 * e.g. a schedule or a worker, will not accept {@link WorkflowVersionStart}.
	 */
	with<Path extends PathFromObject<WorkflowStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowStartOptions, Path>
	): WorkflowVersionWith<Path, Input, Output, Context, TEvents>;

	start(
		client: Client<Context>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Output, Context, TEvents>>;

	startAsChild<ParentEvents extends EventsDefinition>(
		parentRun: WorkflowRun<Context, ParentEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Output, Context, TEvents>>;

	getHandleById(client: Client<Context>, runId: string): Promise<WorkflowRunHandle<Output, Context, TEvents>>;

	getHandleByReferenceId(
		client: Client<Context>,
		referenceId: string
	): Promise<WorkflowRunHandle<Output, Context, TEvents>>;

	[INTERNAL]: {
		eventsDefinition: TEvents;
		handler: (run: WorkflowRun<Context, TEvents>, input: Input) => Promise<void>;
		runOptions: () => WorkflowRunOptions;
	};
}

/** Which of the two types {@link WorkflowVersion.with} gives back, decided by the option you set. */
export type WorkflowVersionWith<Path, Input, Output, Context, TEvents extends EventsDefinition> =
	Path extends PathFromObject<WorkflowRunOptions>
		? WorkflowVersion<Input, Output, Context, TEvents>
		: WorkflowVersionStart<Input, Output, Context, TEvents>;

/**
 * A {@link WorkflowVersion} pinned to one start.
 *
 * You get one by setting an option about one particular run — `reference` names the run, `trigger`
 * says when it goes. Everything a version can do is still here save one thing: a schedule
 * or a worker will not take it. A schedule creates its own starts, one per tick, and has no use for
 * yours; a worker never starts anything at all — it executes runs that already exist, carrying the
 * options recorded on them when they were created.
 */
export interface WorkflowVersionStart<Input, Output, Context, TEvents extends EventsDefinition = EventsDefinition>
	extends Omit<WorkflowVersion<Input, Output, Context, TEvents>, typeof INTERNAL | "with"> {
	with<Path extends PathFromObject<WorkflowStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowStartOptions, Path>
	): WorkflowVersionStart<Input, Output, Context, TEvents>;
}

// biome-ignore lint/suspicious/noExplicitAny: I want any workflow
export type AnyWorkflowVersion = WorkflowVersion<any, any, any, any>;

export class WorkflowVersionImpl<Input, Output, Context, TEvents extends EventsDefinition>
	implements WorkflowVersion<Input, Output, Context, TEvents>
{
	public readonly events: EventMulticasters<TEvents>;
	public readonly [INTERNAL]: WorkflowVersion<Input, Output, Context, TEvents>[typeof INTERNAL];
	private readonly startOptionsBuilder: ObjectBuilder<WorkflowStartOptions>;

	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Input, Output, Context, TEvents>,
		startOptionsBuilder?: ObjectBuilder<WorkflowStartOptions>
	) {
		const eventsDefinition = this.params.events ?? ({} as TEvents);
		this.events = createEventMulticasters(this.name, this.versionId, eventsDefinition);
		this.startOptionsBuilder =
			startOptionsBuilder ?? objectOverrider<WorkflowStartOptions>({ retry: this.params.retry })();
		this[INTERNAL] = {
			eventsDefinition,
			handler: this.handler.bind(this),
			runOptions: this.runOptions.bind(this),
		};
	}

	private runOptions(): WorkflowRunOptions {
		const { retry, pool, priority } = this.startOptionsBuilder.build();
		return { retry, pool, priority };
	}

	public with<Path extends PathFromObject<WorkflowStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowStartOptions, Path>
	): WorkflowVersionWith<Path, Input, Output, Context, TEvents> {
		return new WorkflowVersionImpl(
			this.name,
			this.versionId,
			this.params,
			this.startOptionsBuilder.with(path, value)
		) as WorkflowVersionWith<Path, Input, Output, Context, TEvents>;
	}

	public async start(
		client: Client<Context>,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Output, Context, TEvents>> {
		return this.startWithOptions(client, this.startOptionsBuilder.build(), ...args);
	}

	private async startWithOptions(
		client: Client<Context>,
		startOptions: WorkflowStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<WorkflowRunHandle<Output, Context, TEvents>> {
		let input = args[0];
		const hasher = client[INTERNAL].hasher;
		const clientCodec = client[INTERNAL].codec;
		const codec = clientCodec ? toBoundCodec(clientCodec) : noopCodec;
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

		const inputHash = await hasher(input);
		const { id } = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input: await codec.encode(input),
			inputHash,
			clientCodecApplied: clientCodec !== undefined,
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
		parentRun: WorkflowRun<Context, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Output, Context, TEvents>> {
		return this.startAsChildWithOptions(parentRun, this.startOptionsBuilder.build(), ...args);
	}

	private async startAsChildWithOptions(
		parentRun: WorkflowRun<Context, EventsDefinition>,
		startOptions: WorkflowStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<ChildWorkflowRunHandle<Output, Context, TEvents>> {
		const parentRunHandle = parentRun[INTERNAL].handle;
		parentRunHandle[INTERNAL].assertExecutionAllowed();

		const { client } = parentRunHandle[INTERNAL];

		const inputRaw = args[0];
		const inputSchema = this.params.schema?.input;
		const inputSchemaValidationResult = inputSchema
			? validateWithSchema(parentRunHandle, inputSchema, inputRaw, parentRun.logger, "Invalid workflow data")
			: inputRaw;
		const input =
			inputSchemaValidationResult instanceof Promise ? await inputSchemaValidationResult : inputSchemaValidationResult;
		// we should use a parent hasher instead of the client to enforce consistency
		const hasher = parentRun[INTERNAL].hasher;
		const inputHash = { value: await hasher(input) };

		const referenceId = startOptions.reference?.id;
		const address = getCompositeId<WorkflowRunAddress>({
			name: this.name,
			versionId: this.versionId,
			referenceId: referenceId ?? inputHash.value,
		});
		const parentRunReplayManifest = parentRun[INTERNAL].replayManifest;

		if (parentRunReplayManifest.hasUnconsumedEntries()) {
			const existingRunInfo = parentRunReplayManifest.consumeNextChildWorkflowRun(address);
			if (existingRunInfo) {
				const { run: existingRun } = await client.api.workflowRun.getByIdV1({ id: existingRunInfo.id });

				const logger = parentRun.logger.child({
					"aiki.childWorkflowName": existingRun.name,
					"aiki.childWorkflowVersionId": existingRun.versionId,
					"aiki.childWorkflowRunId": existingRun.id,
				});

				return childWorkflowRunHandle(
					client,
					existingRun as WorkflowRunRecord,
					parentRun[INTERNAL].handle,
					logger,
					this[INTERNAL].eventsDefinition
				);
			}

			await this.throwNonDeterminismError(
				parentRun,
				parentRunHandle,
				inputHash.value,
				referenceId,
				parentRunReplayManifest
			);
		}

		let newRunId: string | undefined;
		try {
			const response = await client.api.workflowRun.createV1({
				name: this.name,
				versionId: this.versionId,
				input: await parentRunHandle[INTERNAL].codec.encode(input),
				inputHash,
				clientCodecApplied: parentRunHandle.run.clientCodecApplied,
				parent: { workflowRunId: parentRun.id, expectedRevision: parentRunHandle.run.revision },
				options: {
					...startOptions,
					pool: startOptions.pool ?? parentRun.options.pool,
					priority: startOptions.priority ?? parentRun.options.priority,
				},
			});
			newRunId = response.id;
		} catch (err) {
			if (isWorkflowRunRevisionConflictError(err)) {
				throw new WorkflowRunRevisionConflictError(parentRun.id);
			}
			throw err;
		}
		const { run: newRun } = await client.api.workflowRun.getByIdV1({ id: newRunId });

		const logger = parentRun.logger.child({
			"aiki.childWorkflowName": newRun.name,
			"aiki.childWorkflowVersionId": newRun.versionId,
			"aiki.childWorkflowRunId": newRun.id,
		});

		logger.info("Created child workflow");

		return childWorkflowRunHandle(
			client,
			newRun as WorkflowRunRecord,
			parentRun[INTERNAL].handle,
			logger,
			this[INTERNAL].eventsDefinition
		);
	}

	private async throwNonDeterminismError(
		parentRun: WorkflowRun<Context, EventsDefinition>,
		parentRunHandle: WorkflowRunHandle<unknown, Context, EventsDefinition>,
		inputHash: string,
		referenceId: string | undefined,
		parentRunReplayManifest: ReplayManifest
	): Promise<never> {
		const unconsumedManifestEntries = parentRunReplayManifest.getUnconsumedEntries();

		const logMeta: Record<string, unknown> = {
			"aiki.workflowName": this.name,
			"aiki.inputHash": inputHash,
			"aiki.unconsumedManifestEntries": unconsumedManifestEntries,
		};
		if (referenceId !== undefined) {
			logMeta["aiki.referenceId"] = referenceId;
		}
		parentRun.logger.error("Replay divergence", logMeta);

		const err = new NonDeterminismError(parentRun.id, parentRunHandle.run.attempts, unconsumedManifestEntries);
		await parentRunHandle[INTERNAL].transitionState({
			status: "failed",
			cause: "self",
			error: createSerializableError(err),
		});
		throw err;
	}

	public async getHandleById(
		client: Client<Context>,
		runId: string
	): Promise<WorkflowRunHandle<Output, Context, TEvents>> {
		return workflowRunHandle(client, runId as WorkflowRunId, this[INTERNAL].eventsDefinition);
	}

	public async getHandleByReferenceId(
		client: Client<Context>,
		referenceId: string
	): Promise<WorkflowRunHandle<Output, Context, TEvents>> {
		const { run } = await client.api.workflowRun.getByReferenceIdV1({
			name: this.name,
			versionId: this.versionId,
			referenceId,
		});
		return workflowRunHandle(client, run as WorkflowRunRecord, this[INTERNAL].eventsDefinition);
	}

	private async handler(run: WorkflowRun<Context, TEvents>, input: Input): Promise<void> {
		const { logger } = run;
		const { assertExecutionAllowed, codec, transitionState } = run[INTERNAL].handle[INTERNAL];

		assertExecutionAllowed();

		const retryStrategy = run.options.retry ?? this.params.retry ?? { type: "never" };

		logger.info("Starting workflow");
		await transitionState({ status: "running" });

		const output = await this.tryExecuteWorkflow(input, run, retryStrategy);

		await transitionState({ status: "completed", output: await codec.encode(output) });
		logger.info("Workflow complete");
	}

	private async tryExecuteWorkflow(
		input: Input,
		run: WorkflowRun<Context, TEvents>,
		retryStrategy: RetryStrategy
	): Promise<Output> {
		const { handle } = run[INTERNAL];

		while (true) {
			try {
				const outputRaw = await this.params.handler(run, input);
				const outputSchema = this.params.schema?.output;
				const outputSchemaValidationResult = outputSchema
					? validateWithSchema(handle, outputSchema, outputRaw, run.logger, "Invalid workflow data")
					: (outputRaw as Output);
				const output =
					outputSchemaValidationResult instanceof Promise
						? await outputSchemaValidationResult
						: outputSchemaValidationResult;
				return output;
			} catch (err) {
				if (
					err instanceof WorkflowRunSuspendedError ||
					err instanceof WorkflowRunFailedError ||
					err instanceof WorkflowRunRevisionConflictError ||
					err instanceof NonDeterminismError
				) {
					throw err;
				}

				const attempts = handle.run.attempts;
				const retryParams = getRetryParams(attempts, retryStrategy);

				if (!retryParams.retriesLeft) {
					const failedState = this.createFailedState(err);
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

				const awaitingRetryState = this.createAwaitingRetryState(err, retryParams.delayMs);
				await handle[INTERNAL].transitionState(awaitingRetryState);

				const logMeta: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(awaitingRetryState)) {
					logMeta[`aiki.${key}`] = value;
				}
				run.logger.info("Workflow awaiting retry", {
					"aiki.attempts": attempts,
					...logMeta,
				});

				// TODO: if delay is small enough, it might be more profitable to wait inline
				// An inline-wait should not reload workflow state or transition to awaiting retry
				// If the workflow failed
				throw new WorkflowRunSuspendedError(run.id);
			}
		}
	}

	private createFailedState(err: unknown): WorkflowRunStateFailed {
		if (err instanceof TaskFailedError) {
			return {
				status: "failed",
				cause: "task",
				taskId: err.taskId,
			};
		}

		return {
			status: "failed",
			cause: "self",
			error: createSerializableError(err),
		};
	}

	private createAwaitingRetryState(err: unknown, nextAttemptInMs: number): WorkflowRunStateAwaitingRetryRequest {
		if (err instanceof TaskFailedError) {
			return {
				status: "awaiting_retry",
				cause: "task",
				nextAttemptInMs,
				taskId: err.taskId,
			};
		}

		return {
			status: "awaiting_retry",
			cause: "self",
			nextAttemptInMs,
			error: createSerializableError(err),
		};
	}
}
