import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { asOpaquePayload } from "@aikirun/testing/payload";

import { processDueTimers } from "./due-timers-consumer";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createScheduleService } from "../service/schedule";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedScheduledRun } from "../testing/seed/run";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const daemonConfig = defaultServerRuntimeConfig.daemons;

const { republishBackoff } = daemonConfig.publishPendingOutboxEntries;

const chunkConfigByTimerType = {
	scheduled: daemonConfig.imminentScheduledRuns.chunk,
	sleep: daemonConfig.imminentSleepElapsedRuns.chunk,
	retry: daemonConfig.imminentRetryableRuns.chunk,
	task_retry: daemonConfig.imminentTaskRetryableRuns.chunk,
	event_wait_timeout: daemonConfig.imminentEventWaitTimedOutRuns.chunk,
	child_wait_timeout: daemonConfig.imminentChildRunWaitTimedOutRuns.chunk,
	recurring: daemonConfig.imminentRecurringRuns.chunk,
};

describe("processDueTimers", () => {
	test("the timer's rank flows to the outbox entry unchanged", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId } = await seedScheduledRun({ repos, namespaceRequestContext }, { options: { priority: 2 } });

				await processDueTimers(
					context,
					{
						repos,
						signal: new AbortController().signal,
						timerPriorityQueue: inMemoryTimerPriorityQueue()({ logger: noopLogger }),
						childRunCanceller: createChildRunCanceller(),
						configProvider: asConfigProvider(() => ({
							pageSize: 100,
							overshootMs: 0,
							republishBackoff,
							maxOccurrencesPerSchedule: daemonConfig.imminentRecurringRuns.maxOccurrencesPerSchedule,
							lookaheadWindowMs: daemonConfig.imminentRecurringRuns.lookaheadWindowMs,
							chunkByTimerType: chunkConfigByTimerType,
						})),
					},
					[{ type: "scheduled", id: runId, rank: computeRank({ dueAt: now, priority: 2 }) }]
				);

				const row = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				// computeRank(scheduledAt = now, priority 2) = 1_000_000 * 10 + 2.
				expect(row).toEqual(
					expect.objectContaining({
						workflowRunId: runId,
						status: "pending",
						rank: 10_000_002,
						nextPublishAttemptRank: 10_000_002,
					})
				);
			});
		}));

	test("a recurring timer arms the timer for the schedule's next run when due soon", () =>
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

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// The next run lands one period on, exactly at the edge of the lookahead.
			await withFakeClock(schedule.nextRunAt, () =>
				processDueTimers(
					context,
					{
						repos,
						signal: new AbortController().signal,
						timerPriorityQueue,
						childRunCanceller: createChildRunCanceller(),
						configProvider: asConfigProvider(() => ({
							pageSize: 100,
							overshootMs: 0,
							republishBackoff,
							maxOccurrencesPerSchedule: daemonConfig.imminentRecurringRuns.maxOccurrencesPerSchedule,
							lookaheadWindowMs: 60_000,
							chunkByTimerType: chunkConfigByTimerType,
						})),
					},
					[{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: schedule.nextRunAt, priority: 2 }) }]
				)
			);

			// The timer fired the occurrence it was set for.
			expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
				expect.objectContaining({ rank: computeRank({ dueAt: schedule.nextRunAt, priority: 2 }) }),
			]);
			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: schedule.nextRunAt + 60_000, priority: 2 }) },
			]);
		}));
});
