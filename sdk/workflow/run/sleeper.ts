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
	const nextIndexBySleepName: Record<SleepName, number> = {};

	return async (name: string, duration: Duration): Promise<SleepResult> => {
		const sleepName = name as SleepName;
		let durationMs = toMilliseconds(duration);

		if (durationMs > MAX_SLEEP_MS) {
			throw new Error(`Sleep duration ${durationMs}ms exceeds maximum of ${MAX_SLEEP_YEARS} years`);
		}

		const nextIndex = nextIndexBySleepName[sleepName] ?? 0;

		const sleepQueue = handle.run.sleepQueues[sleepName] ?? { sleeps: [] };
		const existingSleep = sleepQueue.sleeps[nextIndex];

		if (!existingSleep) {
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

		if (existingSleep.status === "sleeping") {
			logger.debug("Already sleeping", {
				"aiki.sleepName": sleepName,
				"aiki.awakeAt": existingSleep.awakeAt,
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		}

		existingSleep.status satisfies "cancelled" | "completed";
		nextIndexBySleepName[sleepName] = nextIndex + 1;

		if (existingSleep.status === "cancelled") {
			logger.debug("Sleep cancelled", {
				"aiki.sleepName": sleepName,
				"aiki.cancelledAt": existingSleep.cancelledAt,
			});
			return { cancelled: true };
		}

		if (durationMs === existingSleep.durationMs) {
			logger.debug("Sleep completed", {
				"aiki.sleepName": sleepName,
				"aiki.durationMs": durationMs,
				"aiki.completedAt": existingSleep.completedAt,
			});
			return { cancelled: false };
		}

		if (durationMs > existingSleep.durationMs) {
			logger.warn("Higher sleep duration encountered during replay. Sleeping for remaining duration", {
				"aiki.sleepName": sleepName,
				"aiki.historicDurationMs": existingSleep.durationMs,
				"aiki.latestDurationMs": durationMs,
			});
			durationMs -= existingSleep.durationMs;
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
