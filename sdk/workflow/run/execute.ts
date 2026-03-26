import type { Client } from "@aikirun/types/client";
import type { Logger } from "@aikirun/types/logger";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow-run";
import {
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunNotExecutableError,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run-error";

import { createEventWaiters } from "./event";
import { workflowRunHandle } from "./handle";
import { createReplayManifest } from "./replay-manifest";
import { createSleeper } from "./sleeper";
import type { UnknownWorkflowVersion } from "../workflow-version";

export interface ExecuteWorkflowParams<AppContext> {
	client: Client<AppContext>;
	workflowRun: WorkflowRun;
	workflowVersion: UnknownWorkflowVersion;
	logger: Logger;
	options: Required<WorkflowExecutionOptions>;
	heartbeat?: () => Promise<void>;
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

export async function executeWorkflowRun<AppContext>(params: ExecuteWorkflowParams<AppContext>): Promise<boolean> {
	const { client, workflowRun, workflowVersion, logger, options, heartbeat } = params;

	let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

	try {
		if (heartbeat) {
			heartbeatInterval = setInterval(async () => {
				try {
					await heartbeat();
					logger.debug("Heartbeat sent");
				} catch (error) {
					logger.warn("Failed to send heartbeat", {
						"aiki.error": error instanceof Error ? error.message : String(error),
					});
				}
			}, options.heartbeatIntervalMs);
		}

		const eventsDefinition = workflowVersion[INTERNAL].eventsDefinition;
		const handle = await workflowRunHandle(client, workflowRun, eventsDefinition, logger);

		const appContext = client[INTERNAL].createContext ? client[INTERNAL].createContext(workflowRun) : null;

		await workflowVersion[INTERNAL].handler(
			{
				id: workflowRun.id as WorkflowRunId,
				name: workflowRun.name as WorkflowName,
				versionId: workflowRun.versionId as WorkflowVersionId,
				options: workflowRun.options ?? {},
				logger,
				sleep: createSleeper(handle, logger),
				events: createEventWaiters(handle, eventsDefinition, logger),
				[INTERNAL]: {
					handle,
					replayManifest: createReplayManifest(workflowRun),
					options: { spinThresholdMs: options.spinThresholdMs },
				},
			},
			workflowRun.input,
			appContext instanceof Promise ? await appContext : appContext
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
	}
}
