import type { Logger } from "@aikirun/lib/logger";
import { type ObjectBuilder, objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { EventName, EventSendOptions } from "@aikirun/types/workflow/run";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { EventData, EventsDefinition } from "./definition";
import { noopCodec, toOpaquePayloadCodec } from "../codec";

export type EventSenders<TEvents extends EventsDefinition> = {
	[Name in keyof TEvents]: EventSender<EventData<TEvents[Name]>>;
};

export interface EventSender<Data> {
	/** Sets one send option and returns of {@link EventSender}. The original is unchanged. */
	with<Path extends PathFromObject<EventSendOptions>>(
		path: Path,
		value: TypeOfValueAtPath<EventSendOptions, Path>
	): EventSender<Data>;
	send: (...args: Data extends void ? [] : [Data]) => Promise<void>;
}

export function createEventSenders<TEvents extends EventsDefinition, Context>(
	client: Client<Context>,
	workflowRunId: string,
	eventsDefinition: TEvents,
	logger: Logger
): EventSenders<TEvents> {
	const senders = {} as EventSenders<TEvents>;

	for (const [eventName, eventDefinition] of Object.entries(eventsDefinition)) {
		const optionsBuilder = objectOverrider<EventSendOptions>({})();
		const sender = createEventSender(
			client,
			workflowRunId,
			eventName as EventName,
			eventDefinition.schema,
			optionsBuilder,
			logger.child({ "aiki.eventName": eventName })
		) as EventSender<EventData<TEvents[keyof TEvents]>>;
		senders[eventName as keyof TEvents] = sender;
	}

	return senders;
}

function createEventSender<Data, Context>(
	client: Client<Context>,
	workflowRunId: string,
	eventName: EventName,
	schema: StandardSchemaV1<Data> | undefined,
	optionsBuilder: ObjectBuilder<EventSendOptions>,
	logger: Logger
): EventSender<Data> {
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

		const options = optionsBuilder.build();
		const { codec: clientCodec } = client[INTERNAL];
		const codec = clientCodec ? toOpaquePayloadCodec(clientCodec) : noopCodec;
		const jsonData: unknown = data !== undefined ? JSON.parse(JSON.stringify(data)) : data;

		await client.api.workflowRun.sendEventV1({
			id: workflowRunId,
			eventName,
			data: await codec.encode(jsonData),
			clientCodecApplied: clientCodec !== undefined,
			options,
		});

		logger.debug("Sent event to workflow", {
			...(options?.reference ? { "aiki.referenceId": options.reference.id } : {}),
		});
	}

	return {
		with: (path, value) =>
			createEventSender(client, workflowRunId, eventName, schema, optionsBuilder.with(path, value), logger),
		send,
	};
}
