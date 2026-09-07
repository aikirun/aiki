import { hashInput } from "@aikirun/lib/crypto";
import { asOpaquePayload } from "@aikirun/testing/payload";

import { processImminentRecurringRuns } from "./imminent-recurring-runs";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createScheduleService, getReferenceId } from "../service/schedule";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

const NO_CAP = Number.MAX_SAFE_INTEGER;

const config = {
	pageSize: 100,
	lookaheadWindowMs: 0,
	maxOccurrencesPerSchedule: NO_CAP,
	republishBackoff,
	chunk: { size: 100, maxConcurrency: 10 },
};

describe("processImminentRecurringRuns", () => {
	test("the occurrence's outbox rank carries the schedule's run priority", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };

			const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval", everyMs: 60_000, overlapPolicy: "skip" },
				workflowRunOptions: { priority: 2 },
			});
			const occurrence = schedule.nextRunAt + 60_000;

			await withFakeClock(occurrence, () =>
				processImminentRecurringRuns(context, { repos, childRunCanceller: createChildRunCanceller() }, config)
			);

			// computeRank(occurrence, priority 2) = occurrence * 10 + 2.
			expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
				expect.objectContaining({
					workflowName: "send-invoices",
					status: "pending",
					rank: occurrence * 10 + 2,
					nextPublishAttemptRank: occurrence * 10 + 2,
				}),
			]);
		}));

	test("a run created from the schedule copies its hasher declaration", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });

			const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload({ region: "eu-west" }),
				workflowRunInputHash: { value: "client-hash" },
				clientHasherApplied: true,
				clientCodecApplied: false,
				spec: { type: "interval", everyMs: 60_000, overlapPolicy: "skip" },
			});
			const occurrence = schedule.nextRunAt;

			await withFakeClock(occurrence, () =>
				processImminentRecurringRuns(context, { repos, childRunCanceller: createChildRunCanceller() }, config)
			);

			expect(
				await repos.workflowRun.getByReferenceWithWorkflowAndState({
					namespaceId: namespaceRequestContext.namespaceId,
					name: "send-invoices",
					versionId: "v1",
					source: "user",
					referenceId: getReferenceId(schedule.id, occurrence),
				})
			).toEqual(expect.objectContaining({ run: expect.objectContaining({ clientHasherApplied: true }) }));
		}));

	test("an allow schedule owes every occurrence from its next run, oldest first", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };

			const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval", everyMs: 60_000, overlapPolicy: "allow" },
			});

			await withFakeClock(schedule.nextRunAt + 120_000, () =>
				processImminentRecurringRuns(context, { repos, childRunCanceller: createChildRunCanceller() }, config)
			);

			// computeRank(occurrence, default priority) = occurrence * 10 + 5.
			expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
				expect.objectContaining({ rank: schedule.nextRunAt * 10 + 5 }),
				expect.objectContaining({ rank: (schedule.nextRunAt + 60_000) * 10 + 5 }),
				expect.objectContaining({ rank: (schedule.nextRunAt + 120_000) * 10 + 5 }),
			]);
		}));

	test("an allow schedule fires at most the cap's worth of occurrences and stays due at the first one left over", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };

			const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval", everyMs: 60_000, overlapPolicy: "allow" },
			});

			// Three occurrences are due under a cap of two.
			await withFakeClock(schedule.nextRunAt + 120_000, () =>
				processImminentRecurringRuns(
					context,
					{ repos, childRunCanceller: createChildRunCanceller() },
					{ ...config, maxOccurrencesPerSchedule: 2 }
				)
			);

			expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
				expect.objectContaining({ rank: schedule.nextRunAt * 10 + 5 }),
				expect.objectContaining({ rank: (schedule.nextRunAt + 60_000) * 10 + 5 }),
			]);
			expect(await repos.schedule.get(namespaceRequestContext.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({
					lastOccurrence: schedule.nextRunAt + 60_000,
					nextRunAt: schedule.nextRunAt + 120_000,
				})
			);
		}));

	test("a capped allow schedule fires the rest on the next pass", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };

			const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval", everyMs: 60_000, overlapPolicy: "allow" },
			});

			// Three occurrences are due under a cap of two, so the second pass owes one.
			await withFakeClock(schedule.nextRunAt + 120_000, async () => {
				const cappedConfig = { ...config, maxOccurrencesPerSchedule: 2 };
				await processImminentRecurringRuns(
					context,
					{ repos, childRunCanceller: createChildRunCanceller() },
					cappedConfig
				);
				await processImminentRecurringRuns(
					context,
					{ repos, childRunCanceller: createChildRunCanceller() },
					cappedConfig
				);
			});

			expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
				expect.objectContaining({ rank: schedule.nextRunAt * 10 + 5 }),
				expect.objectContaining({ rank: (schedule.nextRunAt + 60_000) * 10 + 5 }),
				expect.objectContaining({ rank: (schedule.nextRunAt + 120_000) * 10 + 5 }),
			]);
			expect(await repos.schedule.get(namespaceRequestContext.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({
					lastOccurrence: schedule.nextRunAt + 120_000,
					nextRunAt: schedule.nextRunAt + 180_000,
				})
			);
		}));
});
