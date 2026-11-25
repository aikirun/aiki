import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import { type ObjectBuilder, objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { EventMulticastResult, EventName, EventSendOptions } from "@aikirun/types/workflow/run";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { EventData, EventsDefinition } from "./definition";
import { noopCodec, toOpaquePayloadCodec } from "../codec";

export type EventMulticasters<TEvents extends EventsDefinition> = {
	[Name in keyof TEvents]: EventMulticaster<EventData<TEvents[Name]>>;
};

export interface EventMulticaster<Data> {
	/** Sets one send option and returns a copy of {@link EventMulticaster}. The original is unchanged. */
	with<Path extends PathFromObject<EventSendOptions>>(
		path: Path,
		value: TypeOfValueAtPath<EventSendOptions, Path>
	): EventMulticaster<Data>;
	send: <Context>(
		client: Client<Context>,
		runId: string | string[],
		...args: Data extends void ? [] : [Data]
	) => Promise<EventMulticastResult>;
	sendByReferenceId<Context>(
		client: Client<Context>,
		referenceId: string | string[],
		...args: Data extends void ? [] : [Data]
	): Promise<EventMulticastResult>;
}

export function createEventMulticasters<TEvents extends EventsDefinition>(
	workflowName: WorkflowName,
	workflowVersionId: WorkflowVersionId,
	eventsDefinition: TEvents
): EventMulticasters<TEvents> {
	const senders = {} as EventMulticasters<TEvents>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const optionsBuilder = objectOverrider<EventSendOptions>({})();
		const sender = createEventMulticaster(
			workflowName,
			workflowVersionId,
			eventName as EventName,
			eventDefinition.schema,
			optionsBuilder
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
	optionsBuilder: ObjectBuilder<EventSendOptions>
): EventMulticaster<Data> {
	async function send<Context>(
		client: Client<Context>,
		runId: string | string[],
		...args: Data extends void ? [] : [Data]
	): Promise<EventMulticastResult> {
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
			return { sentIds: [], failedIds: [] };
		}

		const options = optionsBuilder.build();
		const { codec: clientCodec } = client[INTERNAL];
		const codec = clientCodec ? toOpaquePayloadCodec(clientCodec) : noopCodec;
		const jsonData: unknown = data !== undefined ? JSON.parse(JSON.stringify(data)) : data;

		const result = await client.api.workflowRun.multicastEventV1({
			ids: runIds,
			eventName,
			data: await codec.encode(jsonData),
			clientCodecApplied: clientCodec !== undefined,
			options,
		});

		client.logger.debug("Multicasted event to workflows", {
			"aiki.workflowName": workflowName,
			"aiki.workflowVersionId": workflowVersionId,
			"aiki.sentWorkflowRunIds": result.sentIds,
			"aiki.failedWorkflowRunIds": result.failedIds,
			"aiki.eventName": eventName,
			...(options?.reference ? { "aiki.eventReferenceId": options.reference.id } : {}),
		});

		return result;
	}

	async function sendByReferenceId<Context>(
		client: Client<Context>,
		referenceId: string | string[],
		...args: Data extends void ? [] : [Data]
	): Promise<EventMulticastResult> {
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

		const referenceIds = Array.isArray(referenceId) ? referenceId : [referenceId];
		if (!isNonEmptyArray(referenceIds)) {
			return { sentIds: [], failedIds: [] };
		}

		const options = optionsBuilder.build();
		const { codec: clientCodec } = client[INTERNAL];
		const codec = clientCodec ? toOpaquePayloadCodec(clientCodec) : noopCodec;
		const jsonData: unknown = data !== undefined ? JSON.parse(JSON.stringify(data)) : data;

		const result = await client.api.workflowRun.multicastEventByReferenceV1({
			references: referenceIds.map((referenceId) => ({
				name: workflowName,
				versionId: workflowVersionId,
				referenceId,
			})),
			eventName,
			data: await codec.encode(jsonData),
			clientCodecApplied: clientCodec !== undefined,
			options,
		});

		client.logger.debug("Multicasted event by reference", {
			"aiki.workflowName": workflowName,
			"aiki.workflowVersionId": workflowVersionId,
			"aiki.referenceIds": referenceIds,
			"aiki.sentWorkflowRunIds": result.sentIds,
			"aiki.failedWorkflowRunIds": result.failedIds,
			"aiki.eventName": eventName,
			...(options?.reference ? { "aiki.eventReferenceId": options.reference.id } : {}),
		});

		return result;
	}

	return {
		with: (path, value) =>
			createEventMulticaster(workflowName, workflowVersionId, eventName, schema, optionsBuilder.with(path, value)),
		send,
		sendByReferenceId,
	};
}
