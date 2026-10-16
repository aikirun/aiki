import { hashInput } from "@aikirun/lib/crypto";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { Schedule } from "@aikirun/types/schedule";
import type {
	NonTerminalWorkflowRunStatus,
	TerminalWorkflowRunStatus,
	WorkflowRunId,
} from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import { processImminentRecurringRuns } from "./imminent-recurring-runs";
import { stallUndeliverableRuns } from "./stall-undeliverable-runs";
import { defaultServerRuntimeConfig } from "../config/runtime";
import type { Repositories } from "../infra/db/types";
import { computeMaxRank, computeRank } from "../lib/rank";
import { createScheduleService, getReferenceId } from "../service/schedule";
import { createTaskStateMachine } from "../service/state-machine/task";
import { createWorkflowRunStateMachine } from "../service/state-machine/workflow-run";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness, type DaemonHarnessDeps } from "../testing/harness";
import { completeRun, seedQueuedRun, seedScheduledRun } from "../testing/seed/run";
import { seedActiveSchedule, seedClaimedRunFromSchedule, seedRunFromSchedule } from "../testing/seed/schedule";
import { seedRunningTaskOnRun, seedTaskInEachStatusOnRun } from "../testing/seed/task";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

const NO_CAP = Number.MAX_SAFE_INTEGER;
const ONE_HOUR_MS = 60 * 60 * 1000;

const config = {
	pageSize: 100,
	lookaheadWindowMs: 0,
	overshootMs: 0,
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

			await withFakeClock(occurrence, () => processImminentRecurringRuns(context, { repos }, config));

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

			await withFakeClock(occurrence, () => processImminentRecurringRuns(context, { repos }, config));

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

			await withFakeClock(schedule.nextRunAt + 120_000, () => processImminentRecurringRuns(context, { repos }, config));

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
				processImminentRecurringRuns(context, { repos }, { ...config, maxOccurrencesPerSchedule: 2 })
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
				await processImminentRecurringRuns(context, { repos }, cappedConfig);
				await processImminentRecurringRuns(context, { repos }, cappedConfig);
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

	test("firing a schedule arms a timer for its next run when it falls within the lookahead", () =>
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
				processImminentRecurringRuns(context, { repos, timerPriorityQueue }, { ...config, lookaheadWindowMs: 60_000 })
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: schedule.nextRunAt + 60_000, priority: 2 }) },
			]);
		}));

	test("firing a schedule wakes a waiter when the earliest queued timer is overdue", () =>
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

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const waiter = timerPriorityQueue.createWaiter();
			// Due 30ms before the scan's clock, which is exactly the overshoot, so it sits at the overdue cutoff.
			const frontRank = computeRank({ dueAt: schedule.nextRunAt - 30 });
			await timerPriorityQueue.add({ timers: [{ type: "sleep", id: "run-front", rank: frontRank }], overdueRank: 0 });
			expect(await waiter.wait(0)).toEqual({ rank: frontRank });

			await withFakeClock(schedule.nextRunAt, () =>
				processImminentRecurringRuns(
					context,
					{ repos, timerPriorityQueue },
					{ ...config, lookaheadWindowMs: 60_000, overshootMs: 30 }
				)
			);

			expect(await waiter.wait(0)).toEqual({ rank: frontRank });
			await waiter.close();
		}));

	test("firing a schedule arms no timer when its next run falls beyond the lookahead", () =>
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

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// The next run lands one period on, one millisecond past the lookahead.
			await withFakeClock(schedule.nextRunAt, () =>
				processImminentRecurringRuns(context, { repos, timerPriorityQueue }, { ...config, lookaheadWindowMs: 59_999 })
			);

			expect(await timerPriorityQueue.peekNext()).toBeNull();
		}));

	test("a capped allow schedule arms a timer that is due at once for the occurrences left over", () =>
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

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// Three occurrences are due under a cap of two, so the leftover is already past and the lookahead is moot.
			const now = schedule.nextRunAt + 120_000;
			await withFakeClock(now, () =>
				processImminentRecurringRuns(
					context,
					{ repos, timerPriorityQueue },
					{ ...config, maxOccurrencesPerSchedule: 2, lookaheadWindowMs: 0 }
				)
			);

			expect(
				await timerPriorityQueue.popDue({
					maxRank: computeMaxRank({ dueBy: now }),
					limit: 10,
				})
			).toEqual([{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: now }) }]);
		}));

	type SeedRunFromSchedule = (
		deps: Pick<DaemonHarnessDeps, "context" | "repos" | "publisher">,
		schedule: Schedule
	) => Promise<{ runId: string }>;

	// The run the schedule's first occurrence created, taken to each status the way production gets it there.
	const seedActiveRunFromScheduleByStatus = {
		scheduled: async ({ context, repos, publisher }, schedule) => {
			const { runId } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			const workflowRunStateMachine = createWorkflowRunStateMachine({
				repos,
			});
			await workflowRunStateMachine.transitionState(namespaceRequestContext, {
				type: "pessimistic",
				id: runId,
				state: { status: "paused" },
			});
			await workflowRunStateMachine.transitionState(namespaceRequestContext, {
				type: "pessimistic",
				id: runId,
				state: { status: "scheduled", scheduledInMs: 0, reason: "resumption" },
			});
			return { runId };
		},
		queued: ({ context, repos }, schedule) =>
			seedRunFromSchedule({ daemonContext: context, namespaceRequestContext, repos }, { schedule }),
		running: ({ context, repos, publisher }, schedule) =>
			seedClaimedRunFromSchedule({ daemonContext: context, namespaceRequestContext, repos, publisher }, { schedule }),
		paused: async ({ context, repos, publisher }, schedule) => {
			const { runId } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "pessimistic",
				id: runId,
				state: { status: "paused" },
			});
			return { runId };
		},
		sleeping: async ({ context, repos, publisher }, schedule) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "cool-down", durationMs: ONE_HOUR_MS },
				expectedRevision: revisionWhenClaimed,
			});
			return { runId };
		},
		awaiting_event: async ({ context, repos, publisher }, schedule) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "optimistic",
				id: runId,
				state: { status: "awaiting_event", eventName: "paymentReceived" },
				expectedRevision: revisionWhenClaimed,
				expectedSignalSequence: 0,
			});
			return { runId };
		},
		awaiting_retry: async ({ context, repos, publisher }, schedule) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "optimistic",
				id: runId,
				state: {
					status: "awaiting_retry",
					cause: "self",
					error: { name: "Error", message: "invoice service unavailable" },
					nextAttemptInMs: ONE_HOUR_MS,
				},
				expectedRevision: revisionWhenClaimed,
			});
			return { runId };
		},
		awaiting_task_retry: async ({ context, repos, publisher }, schedule) => {
			const claimedRun = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			const { taskInfo, latestTaskSequence } = await seedRunningTaskOnRun(
				{ repos, namespaceRequestContext },
				claimedRun,
				{ taskName: "charge-payment", input: { invoiceId: "inv-9" } }
			);
			await createTaskStateMachine({ repos }).transitionState(namespaceRequestContext, {
				id: taskInfo.id,
				workflowRunId: claimedRun.runId,
				expectedWorkflowRunRevision: claimedRun.revisionWhenClaimed,
				sequence: latestTaskSequence + 1,
				attempts: 1,
				state: {
					status: "awaiting_retry",
					error: { name: "Error", message: "payment gateway unavailable" },
					nextAttemptInMs: ONE_HOUR_MS,
				},
			});
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "optimistic",
				id: claimedRun.runId,
				state: { status: "awaiting_task_retry" },
				expectedRevision: claimedRun.revisionWhenClaimed,
			});
			return { runId: claimedRun.runId };
		},
		awaiting_child_workflow: async ({ context, repos, publisher }, schedule) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			const childRun = await seedScheduledRun(
				{ repos, namespaceRequestContext },
				{ parent: { workflowRunId: runId, expectedRevision: revisionWhenClaimed } }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "optimistic",
				id: runId,
				state: { status: "awaiting_child_workflow", childWorkflowRunId: childRun.runId },
				expectedRevision: revisionWhenClaimed,
				expectedSignalSequence: 0,
			});
			return { runId };
		},
		stalled: async ({ context, repos }, schedule) => {
			const { runId } = await seedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos },
				{ schedule }
			);
			// The run's outbox row was created at the first occurrence, an hour before this pass.
			await withFakeClock(schedule.nextRunAt + ONE_HOUR_MS, () =>
				stallUndeliverableRuns(
					context,
					{ repos },
					{ maxAgeMs: 60_000, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
				)
			);
			return { runId };
		},
	} satisfies Record<NonTerminalWorkflowRunStatus, SeedRunFromSchedule>;

	const seedTerminalRunFromScheduleByStatus = {
		cancelled: async ({ context, repos, publisher }, schedule) => {
			const { runId } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "pessimistic",
				id: runId,
				state: { status: "cancelled" },
			});
			return { runId };
		},
		completed: async ({ context, repos, publisher }, schedule) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await completeRun({ context: namespaceRequestContext, repos, runId, expectedRevision: revisionWhenClaimed });
			return { runId };
		},
		failed: async ({ context, repos, publisher }, schedule) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "optimistic",
				id: runId,
				state: { status: "failed", cause: "self", error: { name: "Error", message: "invoice service unavailable" } },
				expectedRevision: revisionWhenClaimed,
			});
			return { runId };
		},
	} satisfies Record<TerminalWorkflowRunStatus, SeedRunFromSchedule>;

	for (const [status, seedActiveRunFromSchedule] of Object.entries(seedActiveRunFromScheduleByStatus)) {
		test(`a skip schedule fires no run while the previous run is ${status}, and moves on to the next occurrence`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { schedule } = await seedActiveSchedule(
					{ repos, namespaceRequestContext },
					{ spec: { type: "interval", everyMs: 60_000, overlapPolicy: "skip" } }
				);
				const firstOccurrence = schedule.nextRunAt;
				const secondOccurrence = firstOccurrence + 60_000;
				const { runId } = await seedActiveRunFromSchedule({ context, repos, publisher }, schedule);
				expect(
					await repos.workflowRun.getById({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(expect.objectContaining({ id: runId, status }));

				await withFakeClock(secondOccurrence, () => processImminentRecurringRuns(context, { repos }, config));

				expect(
					await repos.workflowRun.getByReferenceWithWorkflowAndState({
						namespaceId: namespaceRequestContext.namespaceId,
						name: schedule.workflowName,
						versionId: schedule.workflowVersionId,
						source: schedule.workflowSource,
						referenceId: getReferenceId(schedule.id, secondOccurrence),
					})
				).toBeNull();
				expect(await repos.schedule.get(namespaceRequestContext.namespaceId, { id: schedule.id })).toEqual(
					expect.objectContaining({ lastOccurrence: firstOccurrence, nextRunAt: secondOccurrence + 60_000 })
				);
			}));
	}

	for (const [status, seedTerminalRunFromSchedule] of Object.entries(seedTerminalRunFromScheduleByStatus)) {
		test(`a skip schedule fires the occurrence once the previous run is ${status}`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { schedule } = await seedActiveSchedule(
					{ repos, namespaceRequestContext },
					{ spec: { type: "interval", everyMs: 60_000, overlapPolicy: "skip" } }
				);
				const secondOccurrence = schedule.nextRunAt + 60_000;
				const { runId } = await seedTerminalRunFromSchedule({ context, repos, publisher }, schedule);
				expect(
					await repos.workflowRun.getById({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(expect.objectContaining({ id: runId, status }));

				await withFakeClock(secondOccurrence, () => processImminentRecurringRuns(context, { repos }, config));

				expect(
					await repos.workflowRun.getByReferenceWithWorkflowAndState({
						namespaceId: namespaceRequestContext.namespaceId,
						name: schedule.workflowName,
						versionId: schedule.workflowVersionId,
						source: schedule.workflowSource,
						referenceId: getReferenceId(schedule.id, secondOccurrence),
					})
				).toEqual(
					expect.objectContaining({
						run: expect.objectContaining({ scheduleId: schedule.id }),
						state: { status: "queued", reason: "new" },
					})
				);
				expect(await repos.schedule.get(namespaceRequestContext.namespaceId, { id: schedule.id })).toEqual(
					expect.objectContaining({ lastOccurrence: secondOccurrence, nextRunAt: secondOccurrence + 60_000 })
				);
			}));
	}

	test("a cancel_previous schedule cancels the previous run and fires the occurrence", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext },
				{ spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" } }
			);
			const secondOccurrence = schedule.nextRunAt + 60_000;
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);

			await withFakeClock(secondOccurrence, () => processImminentRecurringRuns(context, { repos }, config));

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "cancelled", revision: revisionWhenClaimed + 1 }),
					state: { status: "cancelled", explanation: "Schedule overlap policy" },
				})
			);
			expect(
				await repos.workflowRun.getByReferenceWithWorkflowAndState({
					namespaceId: namespaceRequestContext.namespaceId,
					name: schedule.workflowName,
					versionId: schedule.workflowVersionId,
					source: schedule.workflowSource,
					referenceId: getReferenceId(schedule.id, secondOccurrence),
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ scheduleId: schedule.id }),
					state: { status: "queued", reason: "new" },
				})
			);
		}));

	test("a cancel_previous schedule discards the tasks the previous run left running or awaiting a retry, and keeps the completed and failed ones", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext },
				{ spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" } }
			);
			const claimedRun = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			const { taskIdByStatus } = await seedTaskInEachStatusOnRun({ repos, namespaceRequestContext }, claimedRun);

			await withFakeClock(schedule.nextRunAt + 60_000, () => processImminentRecurringRuns(context, { repos }, config));

			const discardedTasks = await repos.task.listByWorkflowRunIdsAndStatuses(claimedRun.runId, ["discarded"]);
			expect(discardedTasks.map((task) => task.id).sort()).toEqual(
				[taskIdByStatus.running, taskIdByStatus.awaiting_retry].sort()
			);
			expect(await repos.task.listByWorkflowRunIdsAndStatuses(claimedRun.runId, ["completed"])).toEqual([
				expect.objectContaining({ id: taskIdByStatus.completed, status: "completed" }),
			]);
			expect(await repos.task.listByWorkflowRunIdsAndStatuses(claimedRun.runId, ["failed"])).toEqual([
				expect.objectContaining({ id: taskIdByStatus.failed, status: "failed" }),
			]);
		}));

	test("a cancel_previous schedule deletes the previous run's outbox row", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext },
				{ spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" } }
			);
			const { runId } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(expect.objectContaining({ workflowRunId: runId, status: "claimed" }));

			await withFakeClock(schedule.nextRunAt + 60_000, () => processImminentRecurringRuns(context, { repos }, config));

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("a cancel_previous schedule cancels the previous run's sleep", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext },
				{ spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" } }
			);
			const secondOccurrence = schedule.nextRunAt + 60_000;
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			await createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "cool-down", durationMs: ONE_HOUR_MS },
				expectedRevision: revisionWhenClaimed,
			});

			await withFakeClock(secondOccurrence, () => processImminentRecurringRuns(context, { repos }, config));

			expect(await repos.sleep.listByWorkflowRunId(runId as WorkflowRunId)).toEqual([
				expect.objectContaining({
					workflowRunId: runId,
					name: "cool-down",
					status: "cancelled",
					cancelledAt: secondOccurrence,
					completedAt: null,
				}),
			]);
		}));

	test("a cancel_previous schedule creates a cancel-child-runs run for the previous run's children, with that run's pool and priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext },
				{
					spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" },
					workflowRunOptions: { pool: "billing-eu", priority: 2 },
				}
			);
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			// The child carries neither a pool nor a priority, so the ones on the cancel-child-runs run can only
			// come from the cancelled run.
			await seedQueuedRun(
				{ daemonContext: context, namespaceRequestContext, repos },
				{ parent: { workflowRunId: runId, expectedRevision: revisionWhenClaimed } }
			);

			await withFakeClock(schedule.nextRunAt + 60_000, () => processImminentRecurringRuns(context, { repos }, config));

			const { rows: scheduledRuns } = await repos.workflowRun.listByFilters(
				{ namespaceId: namespaceRequestContext.namespaceId, status: ["scheduled"] },
				10,
				0,
				{ order: "asc" }
			);
			expect(
				await Promise.all(
					scheduledRuns.map(({ id }) =>
						repos.workflowRun.getByIdWithWorkflowAndState({ namespaceId: namespaceRequestContext.namespaceId, id })
					)
				)
			).toEqual([
				expect.objectContaining({
					workflow: { name: "cancel-child-runs", versionId: "1.0.0", source: "system" },
					run: expect.objectContaining({
						input: runId,
						options: expect.objectContaining({ pool: "billing-eu", priority: 2 }),
					}),
				}),
			]);
		}));

	test("a cancel_previous schedule adds the cancel-child-runs run's timer to the priority queue, at the cancelled run's priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext },
				{
					spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" },
					workflowRunOptions: { priority: 2 },
				}
			);
			const { runId, revisionWhenClaimed } = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule }
			);
			// The child carries no priority, so the timer's priority can only come from the cancelled run.
			await seedQueuedRun(
				{ daemonContext: context, namespaceRequestContext, repos },
				{ parent: { workflowRunId: runId, expectedRevision: revisionWhenClaimed } }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const firedAt = schedule.nextRunAt + 60_000;
			await withFakeClock(firedAt, () => processImminentRecurringRuns(context, { repos, timerPriorityQueue }, config));

			const { rows: scheduledRuns } = await repos.workflowRun.listByFilters(
				{ namespaceId: namespaceRequestContext.namespaceId, status: ["scheduled"] },
				10,
				0,
				{ order: "asc" }
			);
			expect(scheduledRuns).toEqual([expect.objectContaining({ name: "cancel-child-runs" })]);
			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual(
				scheduledRuns.map(({ id }) => ({ type: "scheduled", id, rank: computeRank({ dueAt: firedAt, priority: 2 }) }))
			);
		}));

	test("a cancel_previous schedule leaves alone a previous run that completes after the listing, and still fires the occurrence", () =>
		withHarness(async ({ context, repos, publisher }) => {
			// Activated at one instant, so both schedules are due at the same occurrences.
			const activatedAt = Date.now();
			const [{ schedule: scheduleOfRunToComplete }, { schedule: scheduleOfRunToCancel }] = await withFakeClock(
				activatedAt,
				async () => [
					await seedActiveSchedule(
						{ repos, namespaceRequestContext },
						{ spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" } }
					),
					await seedActiveSchedule(
						{ repos, namespaceRequestContext },
						{
							workflowName: "send-reminders",
							spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" },
						}
					),
				]
			);
			const secondOccurrence = scheduleOfRunToComplete.nextRunAt + 60_000;
			const runToComplete = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule: scheduleOfRunToComplete }
			);
			const runToCancel = await seedClaimedRunFromSchedule(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ schedule: scheduleOfRunToCancel }
			);

			let listedRunIds: string[] = [];
			const reposCompletingAfterListing: Repositories = {
				...repos,
				workflowRun: {
					...repos.workflowRun,
					listByWorkflowAndReferenceIdPairs: async (...args) => {
						const activeRuns = await repos.workflowRun.listByWorkflowAndReferenceIdPairs(...args);
						listedRunIds = activeRuns.map((run) => run.id);
						await completeRun({
							context: namespaceRequestContext,
							repos,
							runId: runToComplete.runId,
							expectedRevision: runToComplete.revisionWhenClaimed,
						});
						return activeRuns;
					},
				},
			};

			// The other schedule's run is cancelled in the same pass, so the pass goes on to record cancellations.
			await withFakeClock(secondOccurrence, () =>
				processImminentRecurringRuns(context, { repos: reposCompletingAfterListing }, config)
			);
			expect(listedRunIds.sort()).toEqual([runToComplete.runId, runToCancel.runId].sort());
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runToCancel.runId,
				})
			).toEqual(expect.objectContaining({ state: { status: "cancelled", explanation: "Schedule overlap policy" } }));

			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runToComplete.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runToComplete.runId, status: "completed" }),
					state: expect.objectContaining({ status: "completed" }),
				})
			);
			const { rows: completedRunTransitions } = await repos.stateTransition.listByRunId(runToComplete.runId, 10);
			expect(completedRunTransitions.map((transition) => transition.state.status).sort()).toEqual([
				"completed",
				"queued",
				"running",
			]);
			expect(
				await repos.workflowRun.getByReferenceWithWorkflowAndState({
					namespaceId: namespaceRequestContext.namespaceId,
					name: scheduleOfRunToComplete.workflowName,
					versionId: scheduleOfRunToComplete.workflowVersionId,
					source: scheduleOfRunToComplete.workflowSource,
					referenceId: getReferenceId(scheduleOfRunToComplete.id, secondOccurrence),
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ scheduleId: scheduleOfRunToComplete.id }),
					state: { status: "queued", reason: "new" },
				})
			);
		}));

	test("firing a cancel_previous schedule arms a timer for its next run when it falls within the lookahead", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext },
				{
					spec: { type: "interval", everyMs: 60_000, overlapPolicy: "cancel_previous" },
					workflowRunOptions: { priority: 2 },
				}
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// The next run lands one period on, exactly at the edge of the lookahead.
			await withFakeClock(schedule.nextRunAt, () =>
				processImminentRecurringRuns(context, { repos, timerPriorityQueue }, { ...config, lookaheadWindowMs: 60_000 })
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: schedule.nextRunAt + 60_000, priority: 2 }) },
			]);
		}));
});
