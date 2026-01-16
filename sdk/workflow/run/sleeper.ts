import { type Duration, toMilliseconds } from "@aikirun/lib";
import type { Logger } from "@aikirun/types/client";
import type { SleepName, SleepResult } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	type WorkflowRunId,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";

import type { WorkflowRunHandle } from "./handle";

const MAX_SLEEP_YEARS = 10;
const MAX_SLEEP_MS = MAX_SLEEP_YEARS * 365 * 24 * 60 * 60 * 1000;

export function createSleeper(handle: WorkflowRunHandle<unknown, unknown, unknown>, logger: Logger) {
	const nextSleepIndexByName: Record<SleepName, number> = {};

	return async (name: string, duration: Duration): Promise<SleepResult> => {
		const sleepName = name as SleepName;
		let durationMs = toMilliseconds(duration);

		if (durationMs > MAX_SLEEP_MS) {
			throw new Error(`Sleep duration ${durationMs}ms exceeds maximum of ${MAX_SLEEP_YEARS} years`);
		}

		const nextSleepIndex = nextSleepIndexByName[sleepName] ?? 0;

		const sleepQueue = handle.run.sleepsQueue[sleepName] ?? { sleeps: [] };
		const sleepState = sleepQueue.sleeps[nextSleepIndex];

		if (!sleepState) {
			try {
				await handle[INTERNAL].transitionState({ status: "sleeping", sleepName, durationMs });
				logger.info("Going to sleep", {
					"aiki.sleepName": sleepName,
					"aiki.durationMs": durationMs,
				});
			} catch (error) {
				if (error instanceof WorkflowRunRevisionConflictError) {
					throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
				}
				throw error;
			}

			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		}

		if (sleepState.status === "sleeping") {
			logger.debug("Already sleeping", {
				"aiki.sleepName": sleepName,
				"aiki.awakeAt": sleepState.awakeAt,
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		}

		sleepState.status satisfies "cancelled" | "completed";
		nextSleepIndexByName[sleepName] = nextSleepIndex + 1;

		if (sleepState.status === "cancelled") {
			logger.debug("Sleep cancelled", {
				"aiki.sleepName": sleepName,
				"aiki.cancelledAt": sleepState.cancelledAt,
			});
			return { cancelled: true };
		}

		if (durationMs === sleepState.durationMs) {
			logger.debug("Sleep completed", {
				"aiki.sleepName": sleepName,
				"aiki.durationMs": durationMs,
				"aiki.completedAt": sleepState.completedAt,
			});
			return { cancelled: false };
		}

		if (durationMs > sleepState.durationMs) {
			logger.warn("Higher sleep duration encountered during replay. Sleeping for remaining duration", {
				"aiki.sleepName": sleepName,
				"aiki.historicDurationMs": sleepState.durationMs,
				"aiki.latestDurationMs": durationMs,
			});
			durationMs -= sleepState.durationMs;
		} else {
			return { cancelled: false };
		}

		try {
			await handle[INTERNAL].transitionState({ status: "sleeping", sleepName, durationMs });
			logger.info("Sleeping", {
				"aiki.sleepName": sleepName,
				"aiki.durationMs": durationMs,
			});
		} catch (error) {
			if (error instanceof WorkflowRunRevisionConflictError) {
				throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
			}
			throw error;
		}

		throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
	};
}
