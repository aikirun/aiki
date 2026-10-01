import type { TimestampMs } from "@aikirun/lib/timestamp";
import { asOpaquePayload } from "@aikirun/testing/payload";

import { describe, expect, test } from "bun:test";
import { createServiceHarness } from "../../../testing/harness";
import { seedClaimedRun } from "../../../testing/seed/run";
import type { EventWaitRowInsert } from "../types/event-wait";

const withHarness = createServiceHarness();

describe("event wait repository", () => {
	test("lists a run's waits in stamp order, not id order", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });

			// Ids and stamps deliberately disagree: the second-accepted signal carries the
			// smaller id, as two server replicas landing in the same millisecond can produce.
			await repos.eventWait.insert([
				{
					id: "01-smaller-id",
					workflowRunId: runId,
					name: "orderShipped",
					status: "received",
					data: asOpaquePayload({ trackingId: "TRK-2" }),
					clientCodecApplied: false,
					signalSequence: 2,
				},
				{
					id: "02-larger-id",
					workflowRunId: runId,
					name: "orderShipped",
					status: "received",
					data: asOpaquePayload({ trackingId: "TRK-1" }),
					clientCodecApplied: false,
					signalSequence: 1,
				},
			]);

			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({ signalSequence: 1, data: { trackingId: "TRK-1" } }),
				expect.objectContaining({ signalSequence: 2, data: { trackingId: "TRK-2" } }),
			]);
		}));

	test("rejects a timeout row that declares the client codec applied", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const timeoutRow: Omit<EventWaitRowInsert, "id" | "clientCodecApplied"> = {
				workflowRunId: runId,
				name: "orderShipped",
				status: "timeout",
				timedOutAt: 1 as TimestampMs,
				signalSequence: 1,
			};
			await repos.eventWait.insert({ ...timeoutRow, id: "01-declares-false", clientCodecApplied: false });

			await expect(
				repos.eventWait.insert({ ...timeoutRow, id: "02-declares-true", clientCodecApplied: true })
			).rejects.toThrow();
			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({ id: "01-declares-false", status: "timeout", clientCodecApplied: false }),
			]);
		}));

	test("upsert records one wait per reference and keeps the first", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			await repos.eventWait.upsert({
				id: "01-first-send",
				workflowRunId: runId,
				name: "orderShipped",
				status: "received",
				referenceId: "ref-1",
				data: asOpaquePayload({ trackingId: "TRK-1" }),
				clientCodecApplied: false,
				signalSequence: 1,
			});

			await repos.eventWait.upsert({
				id: "02-second-send",
				workflowRunId: runId,
				name: "orderShipped",
				status: "received",
				referenceId: "ref-1",
				data: asOpaquePayload({ trackingId: "TRK-2" }),
				clientCodecApplied: false,
				signalSequence: 2,
			});

			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({
					id: "01-first-send",
					referenceId: "ref-1",
					data: { trackingId: "TRK-1" },
					signalSequence: 1,
				}),
			]);
		}));

	test("upsert records separate waits for separate references", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });

			await repos.eventWait.upsert({
				id: "01-first-reference",
				workflowRunId: runId,
				name: "orderShipped",
				status: "received",
				referenceId: "ref-1",
				data: asOpaquePayload({ trackingId: "TRK-1" }),
				clientCodecApplied: false,
				signalSequence: 1,
			});
			await repos.eventWait.upsert({
				id: "02-second-reference",
				workflowRunId: runId,
				name: "orderShipped",
				status: "received",
				referenceId: "ref-2",
				data: asOpaquePayload({ trackingId: "TRK-2" }),
				clientCodecApplied: false,
				signalSequence: 2,
			});

			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({ id: "01-first-reference", referenceId: "ref-1", signalSequence: 1 }),
				expect.objectContaining({ id: "02-second-reference", referenceId: "ref-2", signalSequence: 2 }),
			]);
		}));
});
