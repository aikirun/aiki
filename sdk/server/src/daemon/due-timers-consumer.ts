import { streamChunks } from "@aikirun/lib/async";
import { groupBy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import { type RetryStrategy, withRetry } from "@aikirun/lib/retry";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { DueTimer, TimerPriorityQueue, TimerPriorityQueueWaiter, TimerType } from "@aikirun/types/infra/timer";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStatus } from "@aikirun/types/workflow/run";

import { queueChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { queueEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { type DueSchedule, queueRecurringRuns } from "./imminent-recurring-runs";
import { queueRetryableRuns } from "./imminent-retryable-runs";
import { queueScheduledRuns } from "./imminent-scheduled-runs";
import { queueSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";
import { queueTaskRetryableRuns } from "./imminent-task-retryable-runs";
import type { RepublishBackoff } from "./publish-pending-outbox-entries";
import type { Repositories } from "../infra/db/types";
import type { WorkflowRunMeta } from "../infra/db/types/workflow-run";
import { computeRank, extractRankDueAtMs, PRIORITY_LEVELS, type Ranked } from "../lib/rank";
import type { DaemonContext } from "../middleware/context";
import { createDaemonContext } from "../middleware/context";
import type { ChildRunCanceller } from "../service/cancel-child-runs";
import { scheduleRowToDomain } from "../service/schedule";

interface DueTimerConsumerConfig {
	limit: number;
	overshootMs: number;
	republishBackoff: RepublishBackoff;
}

export interface DueTimersConsumerDeps {
	repos: Repositories;
	signal: AbortSignal;
	timerPriorityQueue: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
	publisher?: Publisher;
	configProvider: ConfigProvider<DueTimerConsumerConfig>;
}

export async function startDueTimersConsumer(logger: Logger, deps: DueTimersConsumerDeps): Promise<void> {
	const timerPriorityQueueWaiter = deps.timerPriorityQueue.createWaiter();
	deps.signal.addEventListener("abort", () => void timerPriorityQueueWaiter.close(), { once: true });

	try {
		await dueTimersConsumerLoop(logger, deps, timerPriorityQueueWaiter);
	} finally {
		await timerPriorityQueueWaiter.close();
	}
}

async function dueTimersConsumerLoop(
	logger: Logger,
	deps: DueTimersConsumerDeps,
	timerPriorityQueueWaiter: TimerPriorityQueueWaiter
): Promise<void> {
	const { timerPriorityQueue, signal, configProvider } = deps;

	const retryStrategy: RetryStrategy = {
		type: "jittered",
		maxAttempts: Number.POSITIVE_INFINITY,
		baseDelayMs: 1_000,
		maxDelayMs: 30_000,
	};

	// Peek on startup to discover entries left over from a previous consumer's lifecycle.
	// The waiter only unblocks on new entries, so without this the first wait could block indefinitely.
	const nextTimerResponse = await withRetry(() => timerPriorityQueue.peekNext(), retryStrategy, {
		signal,
		onError: (err: unknown) => {
			if (signal.aborted) {
				return;
			}
			logger.warn("Due timers consumer failed, will retry", { err });
		},
	}).run();
	if (nextTimerResponse.state !== "completed") {
		return;
	}
	let nextTimerDueAtMs = nextTimerResponse.result && extractRankDueAtMs(nextTimerResponse.result.rank);

	while (!signal.aborted) {
		await withRetry(
			async () => {
				let newTimer: { rank: number } | null = null;

				if (nextTimerDueAtMs === null) {
					newTimer = await timerPriorityQueueWaiter.wait(0);
				} else {
					const waitMs = nextTimerDueAtMs - Date.now() + configProvider.config.overshootMs;
					if (waitMs > 0) {
						newTimer = await timerPriorityQueueWaiter.wait(waitMs / 1_000);
					}
				}

				if (signal.aborted) {
					return;
				}

				if (newTimer !== null) {
					const newTimerDueAt = extractRankDueAtMs(newTimer.rank);
					if (newTimerDueAt > Date.now()) {
						if (nextTimerDueAtMs === null || newTimerDueAt < nextTimerDueAtMs) {
							nextTimerDueAtMs = newTimerDueAt;
						}
						return;
					}
				}

				const context = createDaemonContext({ name: "process-due-timers", logger, signal });
				const next = () =>
					timerPriorityQueue.popDue({
						// The cutoff must cover every priority digit, so it takes the lowest priority, not the default.
						maxRank: computeRank({ dueAt: Date.now(), priority: PRIORITY_LEVELS - 1 }),
						limit: configProvider.config.limit,
					});

				for await (const dueTimers of streamChunks(next, {
					until: (chunk) => chunk.length < configProvider.config.limit,
				})) {
					try {
						await processDueTimers(context, deps, dueTimers);
					} catch (err) {
						context.logger.error("Failed to process due timers batch", { err });
					}
				}

				const nextTimer = await timerPriorityQueue.peekNext();
				nextTimerDueAtMs = nextTimer && extractRankDueAtMs(nextTimer.rank);
			},
			retryStrategy,
			{
				signal,
				onError: (err: unknown) => {
					if (signal.aborted) {
						return;
					}
					logger.warn("Due timers consumer failed, will retry", { err });
				},
			}
		).run();
	}
}

export async function processDueTimers(
	context: DaemonContext,
	deps: DueTimersConsumerDeps,
	dueTimers: NonEmptyArray<DueTimer>
): Promise<void> {
	const { repos, publisher, configProvider } = deps;

	const timersByType = groupBy(dueTimers, (timer) => [timer.type, timer]);

	const promises: Promise<void>[] = [];

	for (const [timerType, timers] of timersByType) {
		if (timerType === "recurring") {
			const idSet = new Set(timers.map((timer) => timer.id));
			const rows = await repos.schedule.listActiveByIds(context, Array.from(idSet) as NonEmptyArray<string>);
			const schedules: DueSchedule[] = rows.map(({ schedule, workflow }) => ({
				...scheduleRowToDomain(schedule, workflow),
				workflowId: schedule.workflowId,
				namespaceId: schedule.namespaceId as NamespaceId,
				workflowRunInput: schedule.workflowRunInput,
				workflowRunInputHash: schedule.workflowRunInputHash,
				clientCodecApplied: schedule.clientCodecApplied,
			}));
			if (!isNonEmptyArray(schedules)) {
				continue;
			}
			promises.push(queueRecurringRuns(context, deps, schedules, configProvider.config.republishBackoff));
		} else {
			const rankById = new Map(timers.map((timer) => [timer.id, timer.rank]));
			const runStatus = timerTypeToWorkflowRunStatus[timerType];
			const runs: WorkflowRunMeta[] = await repos.workflowRun.listByIdsAndStatus(
				context,
				Array.from(rankById.keys()) as NonEmptyArray<string>,
				runStatus
			);

			const rankedRuns: Ranked<WorkflowRunMeta>[] = [];
			for (const run of runs) {
				const rank = rankById.get(run.id);
				if (rank !== undefined) {
					rankedRuns.push({ ...run, rank });
				}
			}
			if (!isNonEmptyArray(rankedRuns)) {
				continue;
			}

			switch (timerType) {
				case "sleep": {
					promises.push(
						queueSleepElapsedRuns(context, repos, publisher, configProvider.config.republishBackoff, rankedRuns)
					);
					break;
				}
				case "retry": {
					promises.push(
						queueRetryableRuns(context, repos, publisher, configProvider.config.republishBackoff, rankedRuns)
					);
					break;
				}
				case "task_retry": {
					promises.push(
						queueTaskRetryableRuns(context, repos, publisher, configProvider.config.republishBackoff, rankedRuns)
					);
					break;
				}
				case "event_wait_timeout": {
					promises.push(
						queueEventWaitTimedOutRuns(context, repos, publisher, configProvider.config.republishBackoff, rankedRuns)
					);
					break;
				}
				case "child_wait_timeout": {
					promises.push(
						queueChildRunWaitTimedOutRuns(context, repos, publisher, configProvider.config.republishBackoff, rankedRuns)
					);
					break;
				}
				case "scheduled": {
					promises.push(
						queueScheduledRuns(context, repos, publisher, configProvider.config.republishBackoff, rankedRuns)
					);
					break;
				}
				default: {
					timerType satisfies never;
				}
			}
		}
	}

	await Promise.all(promises);
}

const timerTypeToWorkflowRunStatus: Record<Exclude<TimerType, "recurring">, WorkflowRunStatus> = {
	sleep: "sleeping",
	retry: "awaiting_retry",
	task_retry: "awaiting_task_retry",
	event_wait_timeout: "awaiting_event",
	child_wait_timeout: "awaiting_child_workflow",
	scheduled: "scheduled",
};
