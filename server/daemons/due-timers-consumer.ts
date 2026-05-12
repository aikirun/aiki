import { groupBy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";
import { withRetry } from "@aikirun/lib/retry";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import type { WorkflowRunMeta } from "server/infra/db/pg/repository/workflow-run";
import type { Repositories } from "server/infra/db/types";
import type { Logger } from "server/infra/logger";
import type {
	DueTimer,
	TimerSignalWaiter,
	TimerSortedSet,
	TimerType,
	WorkflowRunPublisher,
} from "server/infra/messaging/types";
import { computeRank, type Ranked, rankDueAtMs } from "server/lib/rank";
import type { DaemonContext } from "server/middleware/context";
import { createDaemonContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";
import { scheduleRowToDomain } from "server/service/schedule";

import { queueChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { queueEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { type DueSchedule, queueRecurringWorkflows } from "./imminent-recurring-workflows";
import { queueRetryableRuns } from "./imminent-retryable-runs";
import { queueRetryableTaskRuns } from "./imminent-retryable-task-runs";
import { queueScheduledRuns } from "./imminent-scheduled-runs";
import { queueSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";

export interface DueTimersConsumerDeps {
	repos: Repositories;
	timerSortedSet: TimerSortedSet;
	childRunCanceller: ChildRunCanceller;
	workflowRunPublisher?: WorkflowRunPublisher;
}

export interface DueTimersConsumerOptions {
	limit?: number;
	overshootMs?: number;
}

export interface DueTimersConsumerHandle {
	stop(): Promise<void>;
}

export function spawnDueTimersConsumer(
	logger: Logger,
	deps: DueTimersConsumerDeps,
	options?: DueTimersConsumerOptions
): DueTimersConsumerHandle {
	const abortController = new AbortController();
	const { signal: abortSignal } = abortController;

	const timerSignalWaiter = deps.timerSortedSet.createSignalWaiter();

	withRetry(
		() => dueTimersConsumerLoop(logger, deps, timerSignalWaiter, abortSignal, options),
		{ type: "jittered", maxAttempts: Number.POSITIVE_INFINITY, baseDelayMs: 1_000, maxDelayMs: 30_000 },
		{ abortSignal }
	)
		.run()
		.catch((error) => {
			if (!abortSignal.aborted) {
				logger.error({ error }, "Due timers consumer crashed unexpectedly");
			}
		})
		.finally(() => timerSignalWaiter.close());

	return {
		async stop() {
			abortController.abort();
			await timerSignalWaiter.close();
		},
	};
}

async function dueTimersConsumerLoop(
	logger: Logger,
	deps: DueTimersConsumerDeps,
	timerSignalWaiter: TimerSignalWaiter,
	abortSignal: AbortSignal,
	options?: DueTimersConsumerOptions
): Promise<void> {
	const { limit = 1_000, overshootMs = 30 } = options ?? {};

	// Peek on startup to discover any entries left over from a previous consumer's lifecycle.
	let nextTimerRank = await deps.timerSortedSet.nextRank();
	let nextTimerDueAtMs = nextTimerRank && rankDueAtMs(nextTimerRank);

	while (!abortSignal.aborted) {
		let signal = 0;

		if (nextTimerDueAtMs === null) {
			signal = await timerSignalWaiter.wait(0);
		} else {
			const waitMs = nextTimerDueAtMs - Date.now() + overshootMs;
			if (waitMs > 0) {
				signal = await timerSignalWaiter.wait(waitMs / 1_000);
			}
		}

		if (abortSignal.aborted) {
			break;
		}

		if (signal > Date.now()) {
			if (nextTimerDueAtMs === null || signal < nextTimerDueAtMs) {
				nextTimerDueAtMs = signal;
			}
			continue;
		}

		const context = createDaemonContext({ name: "dueTimersConsumer", logger, signal: abortSignal });

		const next = () => deps.timerSortedSet.popDue(computeRank(Date.now()), limit);

		for await (const dueTimers of streamChunks(next, { until: (chunk) => chunk.length < limit })) {
			try {
				await processDueTimers(context, deps, dueTimers);
			} catch (error) {
				context.logger.error({ error }, "Failed to process due timers batch");
			}
		}

		nextTimerRank = await deps.timerSortedSet.nextRank();
		nextTimerDueAtMs = nextTimerRank && rankDueAtMs(nextTimerRank);
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
