import { streamChunks } from "@aikirun/lib/async";
import { groupBy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Logger } from "@aikirun/lib/logger";
import { type RetryStrategy, withRetry } from "@aikirun/lib/retry";
import type { ConfigProvider } from "@aikirun/types/infra/config";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { DueTimer, TimerPriorityQueue, TimerSignalWaiter, TimerType } from "@aikirun/types/infra/timer";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStatus } from "@aikirun/types/workflow/run";

import { queueChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { queueEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { type DueSchedule, queueRecurringWorkflows } from "./imminent-recurring-workflows";
import { queueRetryableRuns } from "./imminent-retryable-runs";
import { queueRetryableTaskRuns } from "./imminent-retryable-task-runs";
import { queueScheduledRuns } from "./imminent-scheduled-runs";
import { queueSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";
import type { ServerConfig } from "../config";
import type { Repositories } from "../infra/db/types";
import type { WorkflowRunMeta } from "../infra/db/types/workflow-run";
import { computeRank, type Ranked, rankDueAtMs } from "../lib/rank";
import type { DaemonContext } from "../middleware/context";
import { createDaemonContext } from "../middleware/context";
import type { ChildRunCanceller } from "../service/cancel-child-runs";
import { scheduleRowToDomain } from "../service/schedule";

export interface DueTimersConsumerDeps {
	repos: Repositories;
	signal: AbortSignal;
	timerPriorityQueue: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
	workflowRunPublisher?: Publisher;
	configProvider: ConfigProvider<ServerConfig>;
}

export interface DueTimersConsumerHandle {
	stop(): Promise<void>;
}

export function spawnDueTimersConsumer(logger: Logger, deps: DueTimersConsumerDeps): DueTimersConsumerHandle {
	const timerSignalWaiter = deps.timerPriorityQueue.createSignalWaiter();

	const promise = dueTimersConsumerLoop(logger, deps, timerSignalWaiter, deps.signal);

	return {
		async stop() {
			await timerSignalWaiter.close();
			await promise;
		},
	};
}

async function dueTimersConsumerLoop(
	logger: Logger,
	deps: DueTimersConsumerDeps,
	timerSignalWaiter: TimerSignalWaiter,
	abortSignal: AbortSignal
): Promise<void> {
	const retryStrategy: RetryStrategy = {
		type: "jittered",
		maxAttempts: Number.POSITIVE_INFINITY,
		baseDelayMs: 1_000,
		maxDelayMs: 30_000,
	};
	const retryOptions = {
		abortSignal,
		onError: (err: unknown) => {
			if (abortSignal.aborted) {
				return;
			}
			logger.warn("Due timers consumer failed, will retry", { err });
		},
	};

	// Peek on startup to discover entries left over from a previous consumer's lifecycle: they have
	// no pending signal, so without this the first wait could block indefinitely.
	const nextTimerRankResponse = await withRetry(
		() => deps.timerPriorityQueue.peekNextRank(),
		retryStrategy,
		retryOptions
	).run();
	if (nextTimerRankResponse.state !== "completed") {
		return;
	}
	let nextTimerDueAtMs = nextTimerRankResponse.result && rankDueAtMs(nextTimerRankResponse.result);

	while (!abortSignal.aborted) {
		await withRetry(
			async () => {
				const { limit, overshootMs } = deps.configProvider.config.daemons.dueTimersConsumer;
				let timerSignal = 0;

				if (nextTimerDueAtMs === null) {
					timerSignal = await timerSignalWaiter.wait(0);
				} else {
					const waitMs = nextTimerDueAtMs - Date.now() + overshootMs;
					if (waitMs > 0) {
						timerSignal = await timerSignalWaiter.wait(waitMs / 1_000);
					}
				}

				if (abortSignal.aborted) {
					return;
				}

				if (timerSignal > Date.now()) {
					if (nextTimerDueAtMs === null || timerSignal < nextTimerDueAtMs) {
						nextTimerDueAtMs = timerSignal;
					}
					return;
				}

				const context = createDaemonContext({ name: "dueTimersConsumer", logger, signal: abortSignal });
				const next = () => deps.timerPriorityQueue.popDue(computeRank(Date.now()), limit);

				for await (const dueTimers of streamChunks(next, { until: (chunk) => chunk.length < limit })) {
					try {
						await processDueTimers(context, deps, dueTimers);
					} catch (err) {
						context.logger.error("Failed to process due timers batch", { err });
					}
				}

				const nextTimerRank = await deps.timerPriorityQueue.peekNextRank();
				nextTimerDueAtMs = nextTimerRank && rankDueAtMs(nextTimerRank);
			},
			retryStrategy,
			retryOptions
		).run();
	}
}

async function processDueTimers(
	context: DaemonContext,
	deps: DueTimersConsumerDeps,
	dueTimers: NonEmptyArray<DueTimer>
): Promise<void> {
	const timersByType = groupBy(dueTimers, (timer) => [timer.type, timer]);

	const promises: Promise<void>[] = [];

	for (const [timerType, timers] of timersByType) {
		if (timerType === "recurring") {
			const ids = timers.map((timer) => timer.id) as NonEmptyArray<string>;
			const rows = await deps.repos.schedule.listActiveByIds(context, ids);
			const schedules: DueSchedule[] = rows.map(({ schedule, workflow }) => ({
				...scheduleRowToDomain(schedule, workflow),
				workflowId: schedule.workflowId,
				namespaceId: schedule.namespaceId as NamespaceId,
				workflowRunInputHash: schedule.workflowRunInputHash,
			}));
			if (!isNonEmptyArray(schedules)) {
				continue;
			}
			promises.push(queueRecurringWorkflows(context, deps, schedules));
		} else {
			const ids: string[] = [];
			const rankById = new Map<string, number>();
			for (const { id, rank } of timers) {
				ids.push(id);
				rankById.set(id, rank);
			}

			const runStatus = timerTypeToWorkflowRunStatus[timerType];
			const runs: WorkflowRunMeta[] = await deps.repos.workflowRun.listByIdsAndStatus(
				context,
				ids as NonEmptyArray<string>,
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
					promises.push(queueSleepElapsedRuns(context, deps.repos, deps.workflowRunPublisher, rankedRuns));
					break;
				}
				case "retry": {
					promises.push(queueRetryableRuns(context, deps.repos, deps.workflowRunPublisher, rankedRuns));
					break;
				}
				case "task_retry": {
					promises.push(queueRetryableTaskRuns(context, deps.repos, deps.workflowRunPublisher, rankedRuns));
					break;
				}
				case "event_wait_timeout": {
					promises.push(queueEventWaitTimedOutRuns(context, deps.repos, deps.workflowRunPublisher, rankedRuns));
					break;
				}
				case "child_wait_timeout": {
					promises.push(queueChildRunWaitTimedOutRuns(context, deps.repos, deps.workflowRunPublisher, rankedRuns));
					break;
				}
				case "scheduled": {
					promises.push(queueScheduledRuns(context, deps.repos, deps.workflowRunPublisher, rankedRuns));
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
	task_retry: "running",
	event_wait_timeout: "awaiting_event",
	child_wait_timeout: "awaiting_child_workflow",
	scheduled: "scheduled",
};
