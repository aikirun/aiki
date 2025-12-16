import type { Logger } from "@aikirun/types/client";
import type { WorkflowRunHandle } from "./run-handle";
import type { SleepParams, SleepStateNone } from "@aikirun/types/sleep";
import { INTERNAL } from "@aikirun/types/symbols";
import { delay, toMilliseconds } from "@aikirun/lib";
import { type WorkflowRunId, WorkflowSuspendedError } from "@aikirun/types/workflow-run";

interface SleeperOptions {
	spinThresholdMs: number;
}

const MAX_SLEEP_MS = 100 * 365 * 24 * 60 * 60 * 1000; // 100 years

export function workflowRunSleeper(
	workflowRunHandle: WorkflowRunHandle<unknown, unknown>,
	logger: Logger,
	options: SleeperOptions
) {
	return async (params: SleepParams) => {
		const { id: sleepId, ...durationFields } = params;
		const durationMs = toMilliseconds(durationFields);

		if (durationMs > MAX_SLEEP_MS) {
			throw new Error(`Sleep duration ${durationMs}ms exceeds maximum of 100 years`);
		}

		const sleepPath = `${sleepId}/${durationMs}`;

		const sleepState = workflowRunHandle[INTERNAL].getSleepState(sleepPath);
		if (sleepState.status === "completed") {
			logger.debug("Sleep completed, skipping", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			return;
		}
		if (sleepState.status === "sleeping") {
			logger.debug("Already sleeping", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			throw new WorkflowSuspendedError(workflowRunHandle.run.id as WorkflowRunId);
		}
		sleepState satisfies SleepStateNone;

		if (durationMs <= options.spinThresholdMs) {
			logger.debug("Spinning for short sleep", {
				"aiki.sleepId": sleepId,
				"aiki.durationMs": durationMs,
			});
			await delay(durationMs);
			return;
		}

		await workflowRunHandle.transitionState({ status: "sleeping", sleepPath, durationMs });

		logger.info("Workflow sleeping", {
			"aiki.sleepId": sleepId,
			"aiki.durationMs": durationMs,
		});

		throw new WorkflowSuspendedError(workflowRunHandle.run.id as WorkflowRunId);
	};
}
