import { isNonEmptyArray, toMilliseconds } from "@aikirun/lib";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import type { EventName, EventSendOptions, EventState, EventWaitOptions, EventWaitState } from "@aikirun/types/event";
import type { Serializable } from "@aikirun/types/serializable";
import { INTERNAL } from "@aikirun/types/symbols";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	type WorkflowRun,
	WorkflowRunConflictError,
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { WorkflowRunHandle } from "./handle";

/**
 * Defines an event type that can be sent to and waited for by workflows.
 *
 * Events are type-first with optional runtime schema validation.
 *
 * @template Data - Type of event data (must be JSON serializable)
 * @param params - Optional event configuration
 * @param opts.schema - Optional schema for runtime validation
 * @returns EventDefinition for use in workflows
 *
 * @example
 * ```typescript
 * // Type-only event (no runtime validation)
 * const approved = event<{ by: string }>();
 *
 * // Event with runtime validation
 * const rejected = event<{ by: string; reason: string }>({
 *   schema: z.object({ by: z.string(), reason: z.string() })
 * });
 * ```
 */
export function event(): EventDefinition<void>;
export function event<Data extends Serializable>(params?: EventParams<Data>): EventDefinition<Data>;
export function event<Data>(params?: EventParams<Data>): EventDefinition<Data> {
	return {
		// biome-ignore lint/style/useNamingConvention: phantom type marker
		_type: undefined as Data,
		schema: params?.schema,
	};
}

export interface EventParams<Data> {
	schema?: StandardSchemaV1<Data>;
}

interface EventDefinition<Data> {
	_type: Data;
	schema?: StandardSchemaV1<Data>;
}

export type EventsDefinition = Record<string, EventDefinition<unknown>>;

export type EventData<TEvent> = TEvent extends EventDefinition<infer Data> ? Data : never;

export type EventWaiters<TEvents extends EventsDefinition> = {
	[K in keyof TEvents]: EventWaiter<EventData<TEvents[K]>>;
};

export interface EventWaiter<Data> {
	wait(options?: EventWaitOptions<false>): Promise<EventWaitState<Data, false>>;
	wait(options: EventWaitOptions<true>): Promise<EventWaitState<Data, true>>;
}

export type EventSenders<TEvents extends EventsDefinition> = {
	[K in keyof TEvents]: EventSender<EventData<TEvents[K]>>;
};

export interface EventSender<Data> {
	with(): EventSenderBuilder<Data>;
	send: (...args: Data extends void ? [] : [Data]) => Promise<void>;
}

export interface EventSenderBuilder<Data> {
	opt<Path extends PathFromObject<EventSendOptions>>(
		path: Path,
		value: TypeOfValueAtPath<EventSendOptions, Path>
	): EventSenderBuilder<Data>;
	send: (...args: Data extends void ? [] : [Data]) => Promise<void>;
}

export type EventMulticasters<TEvents extends EventsDefinition> = {
	[K in keyof TEvents]: EventMulticaster<EventData<TEvents[K]>>;
};

export interface EventMulticaster<Data> {
	with(): EventMulticasterBuilder<Data>;
	send: <AppContext>(
		client: Client<AppContext>,
		runId: string | string[],
		...args: Data extends void ? [] : [Data]
	) => Promise<void>;
}

export interface EventMulticasterBuilder<Data> {
	opt<Path extends PathFromObject<EventSendOptions>>(
		path: Path,
		value: TypeOfValueAtPath<EventSendOptions, Path>
	): EventMulticasterBuilder<Data>;
	send: <AppContext>(
		client: Client<AppContext>,
		runId: string | string[],
		...args: Data extends void ? [] : [Data]
	) => Promise<void>;
}

export function createEventWaiters<TEvents extends EventsDefinition>(
	handle: WorkflowRunHandle<unknown, unknown, unknown, TEvents>,
	eventsDefinition: TEvents,
	logger: Logger
): EventWaiters<TEvents> {
	const waiters = {} as EventWaiters<TEvents>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const waiter = createEventWaiter(
			handle,
			eventName as EventName,
			eventDefinition.schema,
			logger.child({ "aiki.eventName": eventName })
		) as EventWaiter<EventData<TEvents[keyof TEvents]>>;
		waiters[eventName as keyof TEvents] = waiter;
	}

	return waiters;
}

export function createEventWaiter<TEvents extends EventsDefinition, Data>(
	handle: WorkflowRunHandle<unknown, unknown, unknown, TEvents>,
	eventName: EventName,
	schema: StandardSchemaV1<Data> | undefined,
	logger: Logger
): EventWaiter<Data> {
	let nextEventIndex = 0;

	async function wait(options?: EventWaitOptions<false>): Promise<EventWaitState<Data, false>>;
	async function wait(options: EventWaitOptions<true>): Promise<EventWaitState<Data, true>>;
	async function wait(options?: EventWaitOptions<boolean>): Promise<EventWaitState<Data, boolean>> {
		await handle.refresh();

		const events = handle.run.eventsQueue[eventName]?.events ?? [];

		const event = events[nextEventIndex] as EventState<Data> | undefined;
		if (event) {
			nextEventIndex++;

			if (event.status === "timeout") {
				logger.debug("Timed out waiting for event");
				return { timeout: true };
			}

			let data = event.data;
			if (schema) {
				const schemaValidation = schema["~standard"].validate(event.data);
				const schemaValidationResult = schemaValidation instanceof Promise ? await schemaValidation : schemaValidation;
				if (!schemaValidationResult.issues) {
					data = schemaValidationResult.value;
				} else {
					logger.error("Invalid event data", { "aiki.issues": schemaValidationResult.issues });
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
			}

			logger.debug("Event received");
			return { timeout: false, data: data as Data };
		}

		const timeoutInMs = options?.timeout && toMilliseconds(options.timeout);

		try {
			await handle[INTERNAL].transitionState({
				status: "awaiting_event",
				eventName,
				timeoutInMs,
			});
			logger.info("Waiting for event", {
				...(timeoutInMs !== undefined ? { "aiki.timeoutInMs": timeoutInMs } : {}),
			});
		} catch (error) {
			if (error instanceof WorkflowRunConflictError) {
				throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
			}
			throw error;
		}

		throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
	}

	return { wait };
}

export function createEventSenders<TEvents extends EventsDefinition>(
	api: ApiClient,
	workflowRunId: string,
	eventsDefinition: TEvents,
	logger: Logger,
	onSend: (run: WorkflowRun<unknown, unknown>) => void
): EventSenders<TEvents> {
	const senders = {} as EventSenders<TEvents>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const sender = createEventSender(
			api,
			workflowRunId,
			eventName as EventName,
			eventDefinition.schema,
			logger.child({ "aiki.eventName": eventName }),
			onSend
		) as EventSender<EventData<TEvents[keyof TEvents]>>;
		senders[eventName as keyof TEvents] = sender;
	}

	return senders;
}

function createEventSender<Data>(
	api: ApiClient,
	workflowRunId: string,
	eventName: EventName,
	schema: StandardSchemaV1<Data> | undefined,
	logger: Logger,
	onSend: (run: WorkflowRun<unknown, unknown>) => void,
	options?: EventSendOptions
): EventSender<Data> {
	const optsOverrider = objectOverrider(options ?? {});

	const createBuilder = (optsBuilder: ReturnType<typeof optsOverrider>): EventSenderBuilder<Data> => ({
		opt: (path, value) => createBuilder(optsBuilder.with(path, value)),
		send: (...args: Data extends void ? [] : [Data]) =>
			createEventSender(api, workflowRunId, eventName, schema, logger, onSend, optsBuilder.build()).send(...args),
	});

	async function send(...args: Data extends void ? [] : [Data]): Promise<void> {
		let data = args[0];
		if (schema) {
			const schemaValidation = schema["~standard"].validate(data);
			const schemaValidationResult = schemaValidation instanceof Promise ? await schemaValidation : schemaValidation;
			if (schemaValidationResult.issues) {
				logger.error("Invalid event data", { "aiki.issues": schemaValidationResult.issues });
				throw new SchemaValidationError("Invalid event data", schemaValidationResult.issues);
			}
			data = schemaValidationResult.value;
		}

		const { run } = await api.workflowRun.sendEventV1({
			id: workflowRunId,
			eventName,
			data,
			options,
		});
		onSend(run);

		logger.info("Sent event to workflow", {
			...(options?.reference ? { "aiki.referenceId": options.reference.id } : {}),
		});
	}

	return {
		with: () => createBuilder(optsOverrider()),
		send,
	};
}

export function createEventMulticasters<TEvents extends EventsDefinition>(
	workflowName: WorkflowName,
	workflowVersionId: WorkflowVersionId,
	eventsDefinition: TEvents
): EventMulticasters<TEvents> {
	const senders = {} as EventMulticasters<TEvents>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const sender = createEventMulticaster(
			workflowName,
			workflowVersionId,
			eventName as EventName,
			eventDefinition.schema
		) as EventMulticaster<EventData<TEvents[keyof TEvents]>>;
		senders[eventName as keyof TEvents] = sender;
	}

	return senders;
}

function createEventMulticaster<Data>(
	workflowName: WorkflowName,
	workflowVersionId: WorkflowVersionId,
	eventName: EventName,
	schema: StandardSchemaV1<Data> | undefined,
	options?: EventSendOptions
): EventMulticaster<Data> {
	const optsOverrider = objectOverrider(options ?? {});

	const createBuilder = (optsBuilder: ReturnType<typeof optsOverrider>): EventMulticasterBuilder<Data> => ({
		opt: (path, value) => createBuilder(optsBuilder.with(path, value)),
		send: <AppContext>(
			client: Client<AppContext>,
			runId: string | string[],
			...args: Data extends void ? [] : [Data]
		) =>
			createEventMulticaster(workflowName, workflowVersionId, eventName, schema, optsBuilder.build()).send(
				client,
				runId,
				...args
			),
	});

	async function send<AppContext>(
		client: Client<AppContext>,
		runId: string | string[],
		...args: Data extends void ? [] : [Data]
	): Promise<void> {
		let data = args[0];
		if (schema) {
			const schemaValidation = schema["~standard"].validate(data);
			const schemaValidationResult = schemaValidation instanceof Promise ? await schemaValidation : schemaValidation;
			if (schemaValidationResult.issues) {
				client.logger.error("Invalid event data", {
					"aiki.workflowName": workflowName,
					"aiki.workflowVersionId": workflowVersionId,
					"aiki.eventName": eventName,
					"aiki.issues": schemaValidationResult.issues,
				});
				throw new SchemaValidationError("Invalid event data", schemaValidationResult.issues);
			}
			data = schemaValidationResult.value;
		}

		const runIds = Array.isArray(runId) ? runId : [runId];
		if (!isNonEmptyArray(runIds)) {
			return;
		}

		await client.api.workflowRun.multicastEventV1({
			ids: runIds,
			eventName,
			data,
			options,
		});

		client.logger.info("Multicasted event to workflows", {
			"aiki.workflowName": workflowName,
			"aiki.workflowVersionId": workflowVersionId,
			"aiki.workflowRunIds": runIds,
			"aiki.eventName": eventName,
			...(options?.reference ? { "aiki.referenceId": options.reference.id } : {}),
		});
	}

	return {
		with: () => createBuilder(optsOverrider()),
		send,
	};
}
