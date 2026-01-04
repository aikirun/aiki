import { type Duration, toMilliseconds } from "@aikirun/lib";
import type { Logger } from "@aikirun/types/client";
import type { SleepId, SleepResult } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import { type WorkflowRunId, WorkflowRunSuspendedError } from "@aikirun/types/workflow-run";

import type { WorkflowRunHandle } from "./handle";

const MAX_SLEEP_YEARS = 10;
const MAX_SLEEP_MS = MAX_SLEEP_YEARS * 365 * 24 * 60 * 60 * 1000;

export function createSleeper(handle: WorkflowRunHandle<unknown, unknown, unknown>, logger: Logger) {
	const nextSleepIndexById: Record<SleepId, number> = {};

	return async (id: string, duration: Duration): Promise<SleepResult> => {
		const sleepId = id as SleepId;
		let durationMs = toMilliseconds(duration);

		if (durationMs > MAX_SLEEP_MS) {
			throw new Error(`Sleep duration ${durationMs}ms exceeds maximum of ${MAX_SLEEP_YEARS} years`);
		}

		const nextSleepIndex = nextSleepIndexById[sleepId] ?? 0;

		const sleepQueue = handle.run.sleepsQueue[sleepId] ?? { sleeps: [] };
		const sleepState = sleepQueue.sleeps[nextSleepIndex];

		if (!sleepState) {
			await handle[INTERNAL].transitionState({ status: "sleeping", sleepId, durationMs });
			logger.info("Workflow going to sleep", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		}

		if (sleepState.status === "sleeping") {
			logger.debug("Already sleeping", {
				"aiki.sleepId": sleepId,
				"aiki.awakeAt": sleepState.awakeAt,
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		}

		sleepState.status satisfies "cancelled" | "completed";
		nextSleepIndexById[sleepId] = nextSleepIndex + 1;

		if (sleepState.status === "cancelled") {
			logger.debug("Sleep cancelled", {
				"aiki.sleepId": sleepId,
				"aiki.cancelledAt": sleepState.cancelledAt,
			});
			return { cancelled: true };
		}

		if (durationMs === sleepState.durationMs) {
			logger.debug("Sleep completed", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
				"aiki.completedAt": sleepState.completedAt,
			});
			return { cancelled: false };
		}

		if (durationMs > sleepState.durationMs) {
			logger.warn("Higher sleep duration encountered during replay. Sleeping for remaining duration", {
				"aiki.sleepId": sleepId,
				"aiki.historicDurationMs": sleepState.durationMs,
				"aiki.latestDurationMs": durationMs,
			});
			durationMs -= sleepState.durationMs;
		} else {
			logger.warn("Lower sleep duration encountered during replay. Already slept enough", {
				"aiki.sleepId": sleepId,
				"aiki.historicDurationMs": sleepState.durationMs,
				"aiki.latestDurationMs": durationMs,
			});
			return { cancelled: false };
		}

		await handle[INTERNAL].transitionState({ status: "sleeping", sleepId, durationMs });
		logger.info("Workflow going to sleep", {
			"aiki.sleepId": sleepId,
			"aiki.durationMs": durationMs,
		});
		throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
	};
}
