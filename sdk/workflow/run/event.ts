import { createSerializableError, isNonEmptyArray, toMilliseconds } from "@aikirun/lib";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import type { EventName, EventSendOptions, EventState, EventWaitOptions, EventWaitState } from "@aikirun/types/event";
import type { Serializable } from "@aikirun/types/serializable";
import { INTERNAL } from "@aikirun/types/symbols";
import type { Schema } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	type WorkflowRun,
	WorkflowRunConflictError,
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";

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
		_type: undefined as Data,
		schema: params?.schema,
	};
}

export interface EventParams<Data> {
	schema?: Schema<Data>;
}

interface EventDefinition<Data> {
	_type: Data;
	schema?: Schema<Data>;
}

export type EventsDefinition = Record<string, EventDefinition<unknown>>;

export type EventData<TEventDefinition> = TEventDefinition extends EventDefinition<infer Data> ? Data : never;

export type EventWaiters<TEventsDefinition extends EventsDefinition> = {
	[K in keyof TEventsDefinition]: EventWaiter<EventData<TEventsDefinition[K]>>;
};

export interface EventWaiter<Data> {
	wait(options?: EventWaitOptions<false>): Promise<EventWaitState<Data, false>>;
	wait(options: EventWaitOptions<true>): Promise<EventWaitState<Data, true>>;
}

export type EventSenders<TEventsDefinition extends EventsDefinition> = {
	[K in keyof TEventsDefinition]: EventSender<EventData<TEventsDefinition[K]>>;
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

export type EventMulticasters<TEventsDefinition extends EventsDefinition> = {
	[K in keyof TEventsDefinition]: EventMulticaster<EventData<TEventsDefinition[K]>>;
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

export function createEventWaiters<TEventsDefinition extends EventsDefinition>(
	handle: WorkflowRunHandle<unknown, unknown, unknown, TEventsDefinition>,
	eventsDefinition: TEventsDefinition,
	logger: Logger
): EventWaiters<TEventsDefinition> {
	const waiters = {} as EventWaiters<TEventsDefinition>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const waiter = createEventWaiter(
			handle,
			eventName as EventName,
			eventDefinition.schema,
			logger.child({ "aiki.eventName": eventName })
		) as EventWaiter<EventData<TEventsDefinition[keyof TEventsDefinition]>>;
		waiters[eventName as keyof TEventsDefinition] = waiter;
	}

	return waiters;
}

export function createEventWaiter<TEventsDefinition extends EventsDefinition, Data>(
	handle: WorkflowRunHandle<unknown, unknown, unknown, TEventsDefinition>,
	eventName: EventName,
	schema: Schema<Data> | undefined,
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

			let data: Data | undefined;
			try {
				data = schema ? schema.parse(event.data) : event.data;
			} catch (error) {
				logger.error("Invalid event data", { data: event.data, error });
				await handle[INTERNAL].transitionState({
					status: "failed",
					cause: "self",
					error: createSerializableError(error),
				});
				throw new WorkflowRunFailedError(handle.run.id as WorkflowRunId, handle.run.attempts);
			}

			logger.debug("Event received");
			return { timeout: false, data };
		}

		const timeoutInMs = options?.timeout && toMilliseconds(options.timeout);
		logger.info("Waiting for event", {
			...(timeoutInMs !== undefined ? { "aiki.timeoutInMs": timeoutInMs } : {}),
		});

		try {
			await handle[INTERNAL].transitionState({
				status: "awaiting_event",
				eventName,
				timeoutInMs,
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

export function createEventSenders<TEventsDefinition extends EventsDefinition>(
	api: ApiClient,
	workflowRunId: string,
	eventsDefinition: TEventsDefinition,
	logger: Logger,
	onSend: (run: WorkflowRun<unknown, unknown>) => void
): EventSenders<TEventsDefinition> {
	const senders = {} as EventSenders<TEventsDefinition>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const sender = createEventSender(
			api,
			workflowRunId,
			eventName as EventName,
			eventDefinition.schema,
			logger.child({ "aiki.eventName": eventName }),
			onSend
		) as EventSender<EventData<TEventsDefinition[keyof TEventsDefinition]>>;
		senders[eventName as keyof TEventsDefinition] = sender;
	}

	return senders;
}

function createEventSender<Data>(
	api: ApiClient,
	workflowRunId: string,
	eventName: EventName,
	schema: Schema<Data> | undefined,
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
		const data = isNonEmptyArray(args) ? args[0] : (undefined as Data);

		if (schema) {
			schema.parse(data);
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

export function createEventMulticasters<TEventsDefinition extends EventsDefinition>(
	workflowName: WorkflowName,
	workflowVersionId: WorkflowVersionId,
	eventsDefinition: TEventsDefinition
): EventMulticasters<TEventsDefinition> {
	const senders = {} as EventMulticasters<TEventsDefinition>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const sender = createEventMulticaster(
			workflowName,
			workflowVersionId,
			eventName as EventName,
			eventDefinition.schema
		) as EventMulticaster<EventData<TEventsDefinition[keyof TEventsDefinition]>>;
		senders[eventName as keyof TEventsDefinition] = sender;
	}

	return senders;
}

function createEventMulticaster<Data>(
	workflowName: WorkflowName,
	workflowVersionId: WorkflowVersionId,
	eventName: EventName,
	schema: Schema<Data> | undefined,
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
		const data = isNonEmptyArray(args) ? args[0] : (undefined as Data);

		if (schema) {
			schema.parse(data);
		}

		const runIds = Array.isArray(runId) ? runId : [runId];
		if (!isNonEmptyArray(runIds)) {
			return;
		}

		const logger = client.logger.child({
			"aiki.workflowName": workflowName,
			"aiki.workflowVersionId": workflowVersionId,
			"aiki.eventName": eventName,
		});

		await client.api.workflowRun.multicastEventV1({
			ids: runIds,
			eventName,
			data,
			options,
		});

		logger.info("Multicasted event to workflows", {
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
