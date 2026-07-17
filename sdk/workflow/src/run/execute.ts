import { runOnInterval } from "@aikirun/lib/async";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	CLAIM_REFRESH_INTERVAL_MS,
	NonDeterminismError,
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	type WorkflowRunRecord,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";

import { createEventWaiters } from "./event";
import { workflowRunHandle } from "./handle";
import { createReplayManifest } from "./replay-manifest";
import { createSleeper } from "./sleeper";
import type { AnyWorkflowVersion } from "../workflow-version";

export interface ExecuteWorkflowParams<Context> {
	client: Client<Context>;
	workflowRun: WorkflowRunRecord;
	workflowVersion: AnyWorkflowVersion;
	logger: Logger;
	configProvider: ConfigProvider<Required<WorkflowExecutionConfig>>;
	heartbeat?: () => Promise<void>;
	signal?: AbortSignal;
}

export interface WorkflowExecutionConfig {
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
	const { client, workflowRun, workflowVersion, logger, configProvider, heartbeat, signal } = params;
	const workflowRunId = workflowRun.id as WorkflowRunId;

	const intervals: Array<{ stop: () => void }> = [];
	try {
		intervals.push(
			runOnInterval(() => client.api.workflowRun.heartbeatV1({ id: workflowRunId }), {
				intervalMs: CLAIM_REFRESH_INTERVAL_MS,
				onError: (error: Error): void => {
					if (!signal?.aborted) {
						logger.warn("Failed to refresh claim", {
							"aiki.error": error.message,
						});
					}
				},
				signal,
			})
		);
		if (heartbeat) {
			intervals.push(
				runOnInterval(heartbeat, {
					intervalMs: () => configProvider.config.heartbeatIntervalMs,
					onError: (error: Error): void => {
						if (!signal?.aborted) {
							logger.warn("Failed to send heartbeat", {
								"aiki.error": error.message,
							});
						}
					},
					signal,
				})
			);
		}

		const eventsDefinition = workflowVersion[INTERNAL].eventsDefinition;
		const handle = workflowRunHandle(client, workflowRun, eventsDefinition, logger);

		const createContext = client[INTERNAL].context;
		const context = createContext ? createContext(workflowRun) : null;

		await workflowVersion[INTERNAL].handler(
			{
				id: workflowRunId,
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
					configProvider,
				},
			},
			workflowRun.input
		);

		return true;
	} catch (err) {
		if (
			err instanceof WorkflowRunNotExecutableError ||
			err instanceof WorkflowRunSuspendedError ||
			err instanceof WorkflowRunFailedError ||
			err instanceof WorkflowRunRevisionConflictError ||
			err instanceof NonDeterminismError
		) {
			return true;
		}

		logger.error("Unexpected error during workflow execution", {
			"aiki.error": err instanceof Error ? err.message : String(err),
			"aiki.stack": err instanceof Error ? err.stack : undefined,
		});
		return false;
	} finally {
		for (const interval of intervals) {
			interval.stop();
		}
	}
}
