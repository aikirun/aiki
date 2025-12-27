import { delay, toMilliseconds } from "@aikirun/lib";
import type { Logger } from "@aikirun/types/client";
import type { SleepParams, SleepPath, SleepResult, SleepStateNone } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import { type WorkflowRunId, WorkflowRunSuspendedError } from "@aikirun/types/workflow-run";

import type { WorkflowRunHandle } from "./handle";

interface SleeperOptions {
	spinThresholdMs: number;
}

const MAX_SLEEP_YEARS = 10;
const MAX_SLEEP_MS = MAX_SLEEP_YEARS * 365 * 24 * 60 * 60 * 1000;

export function createSleeper(
	handle: WorkflowRunHandle<unknown, unknown, unknown>,
	logger: Logger,
	options: SleeperOptions
) {
	return async (params: SleepParams): Promise<SleepResult> => {
		const { id: sleepId, ...durationFields } = params;
		const durationMs = toMilliseconds(durationFields);

		if (durationMs > MAX_SLEEP_MS) {
			throw new Error(`Sleep duration ${durationMs}ms exceeds maximum of ${MAX_SLEEP_YEARS} years`);
		}

		const sleepPath = `${sleepId}/${durationMs}` as SleepPath;

		const sleepState = handle.run.sleepsState[sleepPath] ?? { status: "none" };
		if (sleepState.status === "completed") {
			logger.debug("Sleep completed", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			return { cancelled: false };
		}
		if (sleepState.status === "cancelled") {
			logger.debug("Sleep cancelled", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			return { cancelled: true };
		}
		if (sleepState.status === "sleeping") {
			logger.debug("Already sleeping", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		}
		sleepState satisfies SleepStateNone;

		if (durationMs <= options.spinThresholdMs) {
			logger.debug("Spinning for short sleep", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			await delay(durationMs);
			return { cancelled: false };
		}

		await handle[INTERNAL].transitionState({ status: "sleeping", sleepPath, durationMs });

		logger.info("Workflow going to sleep", {
			"aiki.sleepId": sleepId,
			"aiki.durationMs": durationMs,
		});

		throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
	};
}
