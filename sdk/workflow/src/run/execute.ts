import { runOnInterval } from "@aikirun/lib/async";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
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
	configProvider: ConfigProvider<WorkflowExecutionConfig>;
	heartbeat?: {
		send: () => Promise<void>;
		intervalMs: number | (() => number);
	};
	signal?: AbortSignal;
}

export interface WorkflowExecutionConfig {
	/**
	 * Interval at which a worker refreshes its claim on a workflow run it is executing.
	 */
	claimRefreshIntervalMs: number;
	/**
	 * Longest wait the executor absorbs in process (default: 10ms).
	 *
	 * Delays <= maxInlineWaitMs: In-memory wait (fast, no task history entry)
	 * Delays > maxInlineWaitMs: Server state transition (recorded in task history)
	 *
	 * Set to 0 to record all task delays in transition history.
	 */
	maxInlineWaitMs: number;
}

/**
 * Executes a workflow run: replays recorded progress, then advances the handler until the
 * run completes, suspends, or fails.
 *
 * Returns true when the segment reached a recorded outcome (completed, suspended, failed,
 * or the run was not executable), so the caller can settle the delivery.
 * Returns false on an unexpected error, so the caller can leave the delivery eligible for
 * redelivery.
 */
export async function executeWorkflowRun<Context>(params: ExecuteWorkflowParams<Context>): Promise<boolean> {
	const { client, workflowRun, workflowVersion, logger, configProvider, heartbeat, signal } = params;
	const workflowRunId = workflowRun.id as WorkflowRunId;

	const intervals: Array<{ stop: () => void }> = [];
	try {
		intervals.push(
			runOnInterval(() => client.api.workflowRun.claimRefreshV1({ id: workflowRunId }), {
				intervalMs: () => configProvider.config.claimRefreshIntervalMs,
				onError: (err: Error): void => {
					if (!signal?.aborted) {
						logger.warn("Failed to refresh claim", { err });
					}
				},
				signal,
			})
		);
		if (heartbeat) {
			intervals.push(
				runOnInterval(heartbeat.send, {
					intervalMs: heartbeat.intervalMs,
					onError: (err: Error): void => {
						if (!signal?.aborted) {
							logger.warn("Failed to send heartbeat", { err });
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

		logger.error("Unexpected error during workflow execution", { err });
		return false;
	} finally {
		for (const interval of intervals) {
			interval.stop();
		}
	}
}
