import { fireAndForget } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import {
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";

import { createEventWaiters } from "./event";
import { workflowRunHandle } from "./handle";
import { createReplayManifest } from "./replay-manifest";
import { createSleeper } from "./sleeper";
import type { UnknownWorkflowVersion } from "../workflow-version";

export interface ExecuteWorkflowParams<Context> {
	client: Client<Context>;
	workflowRun: WorkflowRunRecord;
	workflowVersion: UnknownWorkflowVersion;
	logger: Logger;
	options: Required<WorkflowExecutionOptions>;
	heartbeat?: () => Promise<void>;
	abortSignal?: AbortSignal;
}

export interface WorkflowExecutionOptions {
	heartbeatIntervalMs?: number;
	/**
	 * Threshold for spinning vs persisting task retry delays (default: 10ms).
	 *
	 * Delays <= threshold: In-memory wait (fast, no task history entry)
	 * Delays > threshold: Server state transition (recorded in task history)
	 *
	 * Set to 0 to record all task delays in transition history.
	 */
	spinThresholdMs?: number;
}

export async function executeWorkflowRun<Context>(params: ExecuteWorkflowParams<Context>): Promise<boolean> {
	const { client, workflowRun, workflowVersion, logger, options, heartbeat, abortSignal } = params;

	let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
	let onAbort: (() => void) | undefined;

	try {
		if (heartbeat) {
			heartbeatInterval = setInterval(() => {
				fireAndForget(heartbeat(), (error) => {
					if (!abortSignal?.aborted) {
						logger.warn("Failed to send heartbeat", {
							"aiki.error": error.message,
						});
					}
				});
			}, options.heartbeatIntervalMs);

			if (abortSignal) {
				onAbort = () => clearInterval(heartbeatInterval);
				abortSignal.addEventListener("abort", onAbort, { once: true });
			}
		}

		const eventsDefinition = workflowVersion[INTERNAL].eventsDefinition;
		const handle = await workflowRunHandle(client, workflowRun, eventsDefinition, logger);

		const context = client[INTERNAL].context ? client[INTERNAL].context(workflowRun) : null;

		await workflowVersion[INTERNAL].handler(
			{
				id: workflowRun.id as WorkflowRunId,
				name: workflowRun.name as WorkflowName,
				versionId: workflowRun.versionId as WorkflowVersionId,
				options: workflowRun.options ?? {},
				logger,
				sleep: createSleeper(handle, logger),
				events: createEventWaiters(handle, eventsDefinition, logger),
				context: context instanceof Promise ? await context : context,
				[INTERNAL]: {
					handle,
					replayManifest: createReplayManifest(workflowRun),
					options: { spinThresholdMs: options.spinThresholdMs },
				},
			},
			workflowRun.input
		);

		return true;
	} catch (error) {
		if (
			error instanceof WorkflowRunNotExecutableError ||
			error instanceof WorkflowRunSuspendedError ||
			error instanceof WorkflowRunFailedError ||
			error instanceof WorkflowRunRevisionConflictError ||
			error instanceof NonDeterminismError
		) {
			return true;
		}

		logger.error("Unexpected error during workflow execution", {
			"aiki.error": error instanceof Error ? error.message : String(error),
			"aiki.stack": error instanceof Error ? error.stack : undefined,
		});
		return false;
	} finally {
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval);
		}
		if (onAbort) {
			abortSignal?.removeEventListener("abort", onAbort);
		}
	}
}
