import type { DurationObject } from "@aikirun/lib/duration";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { Logger } from "@aikirun/lib/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import type { SleepName, SleepResult, WorkflowRunId } from "@aikirun/types/workflow/run";
import { WorkflowRunFailedError, WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";

import type { WorkflowRunHandle } from "./handle/workflow-run";

const MAX_SLEEP_YEARS = 10;
const MAX_SLEEP_MS = MAX_SLEEP_YEARS * 365 * 24 * 60 * 60 * 1_000;

export function createSleeper(handle: WorkflowRunHandle<unknown, unknown>, logger: Logger) {
	const nextIndexBySleepName: Record<SleepName, number> = {};

	return (name: string, duration: DurationObject): Promise<SleepResult> =>
		handle[INTERNAL].executeIfAllowed(async () => {
			const sleepName = name as SleepName;

			const durationValidation = validateSleepDuration(duration);
			if (!durationValidation.valid) {
				logger.error("Invalid sleep duration", {
					"aiki.sleepName": sleepName,
					"aiki.reason": durationValidation.reason,
				});
				await handle[INTERNAL].transitionStateOptimistic({
					status: "failed",
					cause: "self",
					error: { name: "InvalidSleepDurationError", message: durationValidation.reason },
				});
				throw new WorkflowRunFailedError(handle.run.id as WorkflowRunId, handle.run.attempts);
			}
			const { durationMs } = durationValidation;

			const nextIndex = nextIndexBySleepName[sleepName] ?? 0;

			const sleeps = handle.run.sleeps[sleepName] ?? [];
			const existingSleep = sleeps[nextIndex];

			if (!existingSleep) {
				await handle[INTERNAL].transitionStateOptimistic({ status: "sleeping", sleepName, durationMs });
				logger.debug("Going to sleep", {
					"aiki.sleepName": sleepName,
					"aiki.durationMs": durationMs,
				});
				throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
			}

			if (existingSleep.status === "sleeping") {
				logger.debug("Already sleeping", {
					"aiki.sleepName": sleepName,
					"aiki.wakeupAt": existingSleep.wakeupAt,
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

			if (durationMs < existingSleep.durationMs) {
				return { cancelled: false };
			}

			logger.warn("Higher sleep duration encountered during replay. Sleeping for remaining duration", {
				"aiki.sleepName": sleepName,
				"aiki.historicDurationMs": existingSleep.durationMs,
				"aiki.latestDurationMs": durationMs,
			});
			const durationLeftMs = durationMs - existingSleep.durationMs;
			await handle[INTERNAL].transitionStateOptimistic({
				status: "sleeping",
				sleepName,
				durationMs: durationLeftMs,
			});
			logger.debug("Sleeping", {
				"aiki.sleepName": sleepName,
				"aiki.durationMs": durationLeftMs,
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		});
}

type SleepDurationValidationResult = { valid: true; durationMs: number } | { valid: false; reason: string };

function validateSleepDuration(duration: DurationObject): SleepDurationValidationResult {
	let durationMs: number;
	try {
		durationMs = toMilliseconds(duration);
	} catch (err) {
		return { valid: false, reason: err instanceof Error ? err.message : String(err) };
	}

	if (durationMs <= 0) {
		return { valid: false, reason: "Sleep duration must be greater than zero" };
	}
	if (!Number.isInteger(durationMs)) {
		return { valid: false, reason: `Sleep duration ${durationMs}ms is not a whole number of milliseconds` };
	}
	if (durationMs > MAX_SLEEP_MS) {
		return { valid: false, reason: `Sleep duration ${durationMs}ms exceeds maximum of ${MAX_SLEEP_YEARS} years` };
	}
	return { valid: true, durationMs };
}
