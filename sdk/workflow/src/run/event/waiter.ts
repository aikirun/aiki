import { toMilliseconds } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import type { EventName, EventWaitOptions, EventWaitResult, WorkflowRunId } from "@aikirun/types/workflow/run";
import { WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";

import type { EventData, EventsDefinition } from "./definition";
import { noopCodec, resolveAppliedClientCodec, toOpaquePayloadCodec } from "../codec";
import type { WorkflowRunHandle } from "../handle/workflow-run";

export type EventWaiters<TEvents extends EventsDefinition> = {
	[Name in keyof TEvents]: EventWaiter<EventData<TEvents[Name]>>;
};

export interface EventWaiter<Data> {
	wait(options?: EventWaitOptions<false>): Promise<EventWaitResult<Data, false>>;
	wait(options: EventWaitOptions<true>): Promise<EventWaitResult<Data, true>>;
}

export function createEventWaiters<TEvents extends EventsDefinition>(
	handle: WorkflowRunHandle<unknown, unknown, TEvents>,
	eventsDefinition: TEvents,
	logger: Logger
): EventWaiters<TEvents> {
	const waiters = {} as EventWaiters<TEvents>;

	for (const eventName of Object.keys(eventsDefinition)) {
		const waiter = createEventWaiter(
			handle,
			eventName as EventName,
			logger.child({ "aiki.eventName": eventName })
		) as EventWaiter<EventData<TEvents[keyof TEvents]>>;
		waiters[eventName as keyof TEvents] = waiter;
	}

	return waiters;
}

function createEventWaiter<TEvents extends EventsDefinition, Data>(
	handle: WorkflowRunHandle<unknown, unknown, TEvents>,
	eventName: EventName,
	logger: Logger
): EventWaiter<Data> {
	let nextIndex = 0;

	async function wait(options?: EventWaitOptions<false>): Promise<EventWaitResult<Data, false>>;
	async function wait(options: EventWaitOptions<true>): Promise<EventWaitResult<Data, true>>;
	async function wait(options?: EventWaitOptions<boolean>): Promise<EventWaitResult<Data, boolean>> {
		return handle[INTERNAL].executeIfAllowed(async () => {
			const eventWaits = handle.run.eventWaits[eventName] ?? [];

			const existingEventWait = eventWaits[nextIndex];
			if (existingEventWait) {
				nextIndex++;

				if (existingEventWait.status === "timeout") {
					logger.debug("Timed out waiting for event");
					return { timeout: true, timedOutAt: existingEventWait.timedOutAt };
				}

				// The data decodes by its sender's declaration, not the run's: the sender's client
				// wrote it, and that client may hold a codec this run's creator did not, or vice versa.
				const clientCodec = resolveAppliedClientCodec(handle[INTERNAL].client, {
					runId: handle.run.id as WorkflowRunId,
					clientCodecApplied: existingEventWait.clientCodecApplied,
				});
				const codec = clientCodec ? toOpaquePayloadCodec(clientCodec) : noopCodec;
				logger.debug("Event received");
				return {
					timeout: false,
					data: (await codec.decode(existingEventWait.data)) as Data,
					receivedAt: existingEventWait.receivedAt,
				};
			}

			const timeoutInMs = options?.timeout && toMilliseconds(options.timeout);

			await handle[INTERNAL].transitionStateOptimistic({
				status: "awaiting_event",
				eventName,
				timeoutInMs,
			});
			logger.debug("Waiting for event", {
				...(timeoutInMs !== undefined ? { "aiki.timeoutInMs": timeoutInMs } : {}),
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		});
	}

	return { wait };
}
