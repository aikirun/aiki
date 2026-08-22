import { NotFoundError } from "@aikirun/lib/error";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { createWorkflowRunStateMachine } from "./state-machine/workflow-run";
import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createEventService } from "../service/event";
import { withFakeClock } from "../testing/clock";
import { createServiceHarness } from "../testing/harness";
import { seedAwaitingEventRun, seedClaimedRun, seedSleepingRun } from "../testing/seed/run";

const withHarness = createServiceHarness();

function createService(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller });
	return createEventService({ repos, workflowRunStateMachine });
}

describe("EventService sendEventToWorkflowRun", () => {
	test("records a received wait carrying the event data", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const { runId } = await seedClaimedRun({ repos, namespaceRequestContext: context, publisher });

			await createService(repos).sendEventToWorkflowRun(context, {
				runId: runId as WorkflowRunId,
				eventName: "orderShipped",
				data: { trackingId: "TRK-1" },
				reference: undefined,
			});

			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({
					workflowRunId: runId,
					name: "orderShipped",
					status: "received",
					data: { trackingId: "TRK-1" },
					referenceId: null,
				}),
			]);
		}));

	test("a repeat send under the same reference records one wait", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const { runId } = await seedClaimedRun({ repos, namespaceRequestContext: context, publisher });
			const eventService = createService(repos);

			const send = (trackingId: string) =>
				eventService.sendEventToWorkflowRun(context, {
					runId: runId as WorkflowRunId,
					eventName: "orderShipped",
					data: { trackingId },
					reference: { id: "carrier-callback-1" },
				});

			await send("TRK-1");
			await send("TRK-2");

			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({
					workflowRunId: runId,
					name: "orderShipped",
					status: "received",
					data: { trackingId: "TRK-1" },
					referenceId: "carrier-callback-1",
				}),
			]);
		}));

	test("two sends without a reference record two waits", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const { runId } = await seedClaimedRun({ repos, namespaceRequestContext: context, publisher });
			const eventService = createService(repos);

			const send = (trackingId: string) =>
				eventService.sendEventToWorkflowRun(context, {
					runId: runId as WorkflowRunId,
					eventName: "orderShipped",
					data: { trackingId },
					reference: undefined,
				});

			await send("TRK-1");
			await send("TRK-2");

			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({ name: "orderShipped", status: "received", data: { trackingId: "TRK-1" } }),
				expect.objectContaining({ name: "orderShipped", status: "received", data: { trackingId: "TRK-2" } }),
			]);
		}));

	test("rejects a send to a run that does not exist", () =>
		withHarness(async ({ repos, context }) => {
			expect(
				createService(repos).sendEventToWorkflowRun(context, {
					runId: "01JZZZZZZZZZZZZZZZZZZZZZZZ" as WorkflowRunId,
					eventName: "orderShipped",
					data: { trackingId: "TRK-1" },
					reference: undefined,
				})
			).rejects.toThrow(NotFoundError);
		}));
});

describe("EventService sendEventToWorkflowRun waking a parked run", () => {
	test("schedules a run parked on that event name", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const { runId } = await seedAwaitingEventRun(
				{ repos, namespaceRequestContext: context, publisher },
				{ eventName: "orderShipped" }
			);
			const sentAt = Date.now() as TimestampMs;

			await withFakeClock(sentAt, () =>
				createService(repos).sendEventToWorkflowRun(context, {
					runId: runId as WorkflowRunId,
					eventName: "orderShipped",
					data: { trackingId: "TRK-1" },
					reference: undefined,
				})
			);

			expect(await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId })).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "scheduled" }),
					state: { status: "scheduled", reason: "event", scheduledAt: sentAt },
				})
			);
		}));

	test("leaves a run parked on a different event name parked", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const { runId, revisionWhenParked } = await seedAwaitingEventRun(
				{ repos, namespaceRequestContext: context, publisher },
				{ eventName: "orderShipped" }
			);

			await createService(repos).sendEventToWorkflowRun(context, {
				runId: runId as WorkflowRunId,
				eventName: "orderCancelled",
				data: { reason: "customer changed their mind" },
				reference: undefined,
			});

			expect(await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId })).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "awaiting_event", revision: revisionWhenParked }),
					state: { status: "awaiting_event", eventName: "orderShipped" },
				})
			);
			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({ name: "orderCancelled", status: "received" }),
			]);
		}));

	test("leaves a running run running", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				repos,
				namespaceRequestContext: context,
				publisher,
			});

			await createService(repos).sendEventToWorkflowRun(context, {
				runId: runId as WorkflowRunId,
				eventName: "orderShipped",
				data: { trackingId: "TRK-1" },
				reference: undefined,
			});

			expect(await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId })).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "running", revision: revisionWhenClaimed }),
					state: { status: "running" },
				})
			);
		}));
});

describe("EventService multicastEventToWorkflowRuns", () => {
	test("delivers the event to every run it is given", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const first = await seedClaimedRun({ repos, namespaceRequestContext: context, publisher });
			const second = await seedClaimedRun({ repos, namespaceRequestContext: context, publisher });

			const result = await createService(repos).multicastEventToWorkflowRuns(context, {
				runIds: [first.runId, second.runId] as WorkflowRunId[],
				eventName: "orderShipped",
				data: { trackingId: "TRK-1" },
				reference: undefined,
			});

			expect({ sentIds: Array.from(result.sentIds).sort(), failedIds: result.failedIds }).toEqual({
				sentIds: [first.runId, second.runId].sort(),
				failedIds: [],
			});
			expect(await repos.eventWait.listByWorkflowRunId(first.runId)).toEqual([
				expect.objectContaining({ name: "orderShipped", status: "received", data: { trackingId: "TRK-1" } }),
			]);
			expect(await repos.eventWait.listByWorkflowRunId(second.runId)).toEqual([
				expect.objectContaining({ name: "orderShipped", status: "received", data: { trackingId: "TRK-1" } }),
			]);
		}));

	test("delivers to the runs it reached and reports the one it could not", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const reachable = await seedClaimedRun({ repos, namespaceRequestContext: context, publisher });
			const missingRunId = "01JZZZZZZZZZZZZZZZZZZZZZZZ";

			const result = await createService(repos).multicastEventToWorkflowRuns(context, {
				runIds: [reachable.runId, missingRunId] as WorkflowRunId[],
				eventName: "orderShipped",
				data: { trackingId: "TRK-1" },
				reference: undefined,
			});

			expect(result).toEqual({ sentIds: [reachable.runId], failedIds: [missingRunId] });
			expect(await repos.eventWait.listByWorkflowRunId(reachable.runId)).toEqual([
				expect.objectContaining({ name: "orderShipped", status: "received", data: { trackingId: "TRK-1" } }),
			]);
		}));

	test("wakes the run parked on the event and leaves a sleeping one asleep", () =>
		withHarness(async ({ repos, context, publisher }) => {
			const parked = await seedAwaitingEventRun(
				{ repos, namespaceRequestContext: context, publisher },
				{ eventName: "orderShipped" }
			);
			const sleeping = await seedSleepingRun(
				{ repos, namespaceRequestContext: context, publisher },
				{ sleepName: "restockDelay", durationMs: 60_000 }
			);

			const result = await createService(repos).multicastEventToWorkflowRuns(context, {
				runIds: [parked.runId, sleeping.runId] as WorkflowRunId[],
				eventName: "orderShipped",
				data: { trackingId: "TRK-1" },
				reference: undefined,
			});

			expect({ sentIds: Array.from(result.sentIds).sort(), failedIds: result.failedIds }).toEqual({
				sentIds: [parked.runId, sleeping.runId].sort(),
				failedIds: [],
			});

			expect(await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: parked.runId })).toEqual(
				expect.objectContaining({ run: expect.objectContaining({ id: parked.runId, status: "scheduled" }) })
			);
			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: sleeping.runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: sleeping.runId,
						status: "sleeping",
						revision: sleeping.revisionWhenAsleep,
					}),
					state: { status: "sleeping", sleepName: "restockDelay", wakeupAt: sleeping.wakeupAt },
				})
			);
			expect(await repos.sleep.listByWorkflowRunId(sleeping.runId)).toEqual([
				expect.objectContaining({
					name: "restockDelay",
					status: "sleeping",
					wakeupAt: sleeping.wakeupAt,
					completedAt: null,
					cancelledAt: null,
				}),
			]);
		}));
});
