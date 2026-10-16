import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { noopLogger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { DueTimer, TimerType } from "@aikirun/types/infra/timer";
import type { WorkflowRunQueuedReason } from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import { processDueTimers } from "./due-timers-consumer";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { createScheduleService } from "../service/schedule";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness, type DaemonHarnessDeps } from "../testing/harness";
import {
	seedAwaitingChildRun,
	seedAwaitingEventRun,
	seedAwaitingRetryRun,
	seedScheduledRun,
	seedSleepingRun,
} from "../testing/seed/run";
import { seedAwaitingTaskRetryRun } from "../testing/seed/task";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

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

	test("an event wait timeout timer leaves a run waiting when its deadline has not passed", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const suspendedAt = Date.now() as TimestampMs;
			const { runId, revisionWhenSuspended } = await withFakeClock(suspendedAt, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: ONE_HOUR_MS }
				)
			);

			// Frozen at the instant the run was suspended: the wait's own deadline is an hour ahead, while the timer
			// handed in is one set for an earlier wait that has already come due.
			await withFakeClock(suspendedAt, () =>
				processDueTimers(
					context,
					{
						repos,
						signal: new AbortController().signal,
						timerPriorityQueue: inMemoryTimerPriorityQueue()({ logger: noopLogger }),
						configProvider: asConfigProvider(() => ({
							pageSize: 100,
							overshootMs: 0,
							republishBackoff,
							maxOccurrencesPerSchedule: daemonConfig.imminentRecurringRuns.maxOccurrencesPerSchedule,
							lookaheadWindowMs: daemonConfig.imminentRecurringRuns.lookaheadWindowMs,
							chunkByTimerType: chunkConfigByTimerType,
						})),
					},
					[{ type: "event_wait_timeout", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) }]
				)
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "awaiting_event", revision: revisionWhenSuspended }),
				})
			);
			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("a recurring timer creates no run for a schedule whose next run is not due", () =>
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
			});

			// One millisecond short of the schedule's next run, with a timer that claims to be due.
			await withFakeClock(schedule.nextRunAt - 1, () =>
				processDueTimers(
					context,
					{
						repos,
						signal: new AbortController().signal,
						timerPriorityQueue: inMemoryTimerPriorityQueue()({ logger: noopLogger }),
						configProvider: asConfigProvider(() => ({
							pageSize: 100,
							overshootMs: 0,
							republishBackoff,
							maxOccurrencesPerSchedule: daemonConfig.imminentRecurringRuns.maxOccurrencesPerSchedule,
							lookaheadWindowMs: 0,
							chunkByTimerType: chunkConfigByTimerType,
						})),
					},
					[{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: EPOCH_MS }) }]
				)
			);

			expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([]);
		}));

	test("an event wait timeout timer never times out a wait without a deadline", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenSuspended } = await seedAwaitingEventRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ eventName: "orderShipped" }
			);

			// The queue never drops a timer: one set for an earlier wait that received its event
			// still comes due while the run is suspended in a later wait with no deadline.
			await processDueTimers(
				context,
				{
					repos,
					signal: new AbortController().signal,
					timerPriorityQueue: inMemoryTimerPriorityQueue()({ logger: noopLogger }),
					configProvider: asConfigProvider(() => ({
						pageSize: 100,
						overshootMs: 0,
						republishBackoff,
						maxOccurrencesPerSchedule: daemonConfig.imminentRecurringRuns.maxOccurrencesPerSchedule,
						lookaheadWindowMs: daemonConfig.imminentRecurringRuns.lookaheadWindowMs,
						chunkByTimerType: chunkConfigByTimerType,
					})),
				},
				[{ type: "event_wait_timeout", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) }]
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "awaiting_event", revision: revisionWhenSuspended }),
				})
			);
			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	type SeedDueRunByTimerType = {
		[Type in Exclude<TimerType, "recurring">]: (
			deps: Pick<DaemonHarnessDeps, "context" | "repos" | "publisher">
		) => Promise<{
			runId: string;
			dueTimer: DueTimer & { type: Type };
			queuedReason: WorkflowRunQueuedReason;
		}>;
	};

	// Each run is already due, so the timer reaching the right daemon is the only thing left to decide.
	const seedDueRunByTimerType: SeedDueRunByTimerType = {
		scheduled: async ({ repos }) => {
			const { runId } = await withFakeClock(EPOCH_MS, () => seedScheduledRun({ repos, namespaceRequestContext }));
			return {
				runId,
				dueTimer: { type: "scheduled", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) },
				queuedReason: "new",
			};
		},
		sleep: async ({ context, repos, publisher }) => {
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 }
				)
			);
			return {
				runId,
				dueTimer: { type: "sleep", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) },
				queuedReason: "wakeup",
			};
		},
		retry: async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);
			return {
				runId,
				dueTimer: { type: "retry", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) },
				queuedReason: "retry",
			};
		},
		task_retry: async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);
			return {
				runId,
				dueTimer: { type: "task_retry", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) },
				queuedReason: "task_retry",
			};
		},
		event_wait_timeout: async ({ context, repos, publisher }) => {
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);
			return {
				runId,
				dueTimer: { type: "event_wait_timeout", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) },
				queuedReason: "event_wait_timeout",
			};
		},
		child_wait_timeout: async ({ context, repos, publisher }) => {
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingChildRun({ daemonContext: context, namespaceRequestContext, repos, publisher }, { timeoutInMs: 1 })
			);
			return {
				runId,
				dueTimer: { type: "child_wait_timeout", id: runId, rank: computeRank({ dueAt: EPOCH_MS }) },
				queuedReason: "child_workflow_wait_timeout",
			};
		},
	};

	for (const [timerType, seedRun] of Object.entries(seedDueRunByTimerType)) {
		test(`queues the run of a due ${timerType} timer`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId, dueTimer, queuedReason } = await seedRun({ context, repos, publisher });

				await processDueTimers(
					context,
					{
						repos,
						signal: new AbortController().signal,
						timerPriorityQueue: inMemoryTimerPriorityQueue()({ logger: noopLogger }),
						configProvider: asConfigProvider(() => ({
							pageSize: 100,
							overshootMs: 0,
							republishBackoff,
							maxOccurrencesPerSchedule: daemonConfig.imminentRecurringRuns.maxOccurrencesPerSchedule,
							lookaheadWindowMs: daemonConfig.imminentRecurringRuns.lookaheadWindowMs,
							chunkByTimerType: chunkConfigByTimerType,
						})),
					},
					[dueTimer]
				);

				expect(
					await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(
					expect.objectContaining({
						run: expect.objectContaining({ id: runId, status: "queued" }),
						state: { status: "queued", reason: queuedReason },
					})
				);
			}));
	}

	test("queues the runs of two timer types popped in one batch", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const sleepingRun = await seedDueRunByTimerType.sleep({ context, repos, publisher });
			const awaitingRetryRun = await seedDueRunByTimerType.retry({ context, repos, publisher });

			await processDueTimers(
				context,
				{
					repos,
					signal: new AbortController().signal,
					timerPriorityQueue: inMemoryTimerPriorityQueue()({ logger: noopLogger }),
					configProvider: asConfigProvider(() => ({
						pageSize: 100,
						overshootMs: 0,
						republishBackoff,
						maxOccurrencesPerSchedule: daemonConfig.imminentRecurringRuns.maxOccurrencesPerSchedule,
						lookaheadWindowMs: daemonConfig.imminentRecurringRuns.lookaheadWindowMs,
						chunkByTimerType: chunkConfigByTimerType,
					})),
				},
				[sleepingRun.dueTimer, awaitingRetryRun.dueTimer]
			);

			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: sleepingRun.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: sleepingRun.runId, status: "queued" }),
					state: { status: "queued", reason: "wakeup" },
				})
			);
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: awaitingRetryRun.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: awaitingRetryRun.runId, status: "queued" }),
					state: { status: "queued", reason: "retry" },
				})
			);
		}));
});
