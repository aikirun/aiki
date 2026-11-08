import { runOnInterval } from "@aikirun/lib/async";
import type { ConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import type { Logger } from "@aikirun/lib/logger";
import { createSerializableError } from "@aikirun/lib/serializable";
import type { Client } from "@aikirun/types/client";
import { CodecPermanentError } from "@aikirun/types/infra/codec";
import type { BoundHasher } from "@aikirun/types/infra/hasher";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	ClientCodecMissingError,
	CodecDecodeFailedError,
	CodecEncodeFailedError,
	CodecInitFailedError,
	type NonDeterminismError,
	type WorkflowRunFailedError,
	type WorkflowRunId,
	type WorkflowRunNotExecutableError,
	type WorkflowRunRecord,
	type WorkflowRunRevisionConflictError,
	WorkflowRunStateUnknownError,
	type WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";

import { isControlFlowError } from "./control-flow-error";
import { createReplayManifest } from "./replay-manifest";
import { taskExecutionTracker } from "./task-execution-tracker";
import type { AnyWorkflowVersion } from "../../workflow-version";
import { createEventWaiters } from "../event";
import { instantiateWorkflowDefinitionCodec } from "../handle/bound-codec";
import { type WorkflowRunHandle, workflowRunHandle } from "../handle/workflow-run";
import { createSleeper } from "../sleeper";

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
 * Returns false when the run's state is unknown or on an unexpected error, so the caller can leave
 * the delivery eligible for redelivery.
 */
export async function executeWorkflowRun<Context>(params: ExecuteWorkflowParams<Context>): Promise<boolean> {
	const { client, workflowRun, workflowVersion, logger, configProvider, heartbeat, signal } = params;
	const workflowRunId = workflowRun.id as WorkflowRunId;

	const intervals: Array<{ stop: () => void }> = [];
	let flushTaskExecutions: (() => Promise<void>) | undefined;
	let handle: WorkflowRunHandle<unknown, Context> | undefined;
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
		handle = workflowRunHandle(client, workflowRun, {
			eventsDefinition,
			logger,
			workflowCodec: instantiateWorkflowDefinitionCodec(workflowVersion[INTERNAL].codec, logger),
		});
		const { create: createTaskExecutionTracker, flush: taskExecutionsFlusher } = taskExecutionTracker(handle, logger);
		flushTaskExecutions = taskExecutionsFlusher;

		const createContext = client[INTERNAL].context;
		const codec = handle[INTERNAL].codec.workflowInput;

		// Every hash inside the run must come from the hasher that made the run's own hash.
		let hasher: BoundHasher;
		if (!workflowRun.clientHasherApplied) {
			hasher = hashInput;
		} else {
			const clientHasher = client[INTERNAL].hasher;
			if (!clientHasher) {
				logger.error("The workflow run expects a client hasher, but none present", { workflowRunId });
				return false;
			}

			let boundHasher: BoundHasher | null;
			try {
				boundHasher = await clientHasher.for(workflowRun.inputHash);
			} catch (err) {
				logger.error("Cannot get hasher that produced the run's input hash", {
					workflowRunId,
					"aiki.inputHash": workflowRun.inputHash,
					err,
				});
				return false;
			}
			if (!boundHasher) {
				logger.error("The client's hasher cannot hash under the rotation that produced the run's input hash", {
					workflowRunId,
					"aiki.inputHash": workflowRun.inputHash,
				});
				return false;
			}
			hasher = boundHasher;
		}

		await workflowVersion[INTERNAL].handler(
			{
				id: workflowRunId,
				name: workflowRun.name as WorkflowName,
				versionId: workflowRun.versionId as WorkflowVersionId,
				options: workflowRun.options ?? {},
				logger,
				sleep: createSleeper(handle, logger),
				events: createEventWaiters(handle, eventsDefinition, logger),
				[INTERNAL]: {
					handle,
					replayManifest: createReplayManifest(workflowRun),
					createTaskExecutionTracker,
					configProvider,
					hasher,
					createContext: () => (createContext !== undefined && handle !== undefined ? createContext(handle.run) : null),
				},
			},
			await codec.decode(workflowRun.input)
		);

		return true;
	} catch (err) {
		if (isControlFlowError(err)) {
			if (err instanceof ClientCodecMissingError) {
				logger.error("The workflow run  expects a client codec, but none present", { err });
				return false;
			}

			if (err instanceof CodecInitFailedError) {
				logger.error("Codec failed to initialize for the workflow run", { err });
				return false;
			}

			if (err instanceof CodecEncodeFailedError || err instanceof CodecDecodeFailedError) {
				if (err.cause instanceof CodecPermanentError && handle !== undefined) {
					logger.error("The codec permanently failed on a payload of the workflow run", { err });

					return await failRun(handle, err.cause, logger);
				}

				logger.error(
					err instanceof CodecEncodeFailedError
						? "Codec failed to encode a payload of the workflow run"
						: "Codec failed to decode a payload of the workflow run",
					{ err }
				);
				return false;
			}

			if (err instanceof WorkflowRunStateUnknownError) {
				logger.warn("Workflow run state unknown, leaving it for recovery", { err });
				return false;
			}

			err satisfies
				| WorkflowRunNotExecutableError
				| WorkflowRunSuspendedError
				| WorkflowRunFailedError
				| WorkflowRunRevisionConflictError
				| NonDeterminismError;
			return true;
		}

		logger.error("Unexpected error during workflow execution", { err });

		return false;
	} finally {
		// Flushed before the claim refresh stops, so the claim stays live while the
		// tracker waits out task executions that are still running.
		if (flushTaskExecutions) {
			await flushTaskExecutions();
		}
		for (const interval of intervals) {
			interval.stop();
		}
	}
}

async function failRun(handle: WorkflowRunHandle<unknown, unknown>, error: Error, logger: Logger): Promise<boolean> {
	try {
		await handle[INTERNAL].transitionStateOptimistic({
			status: "failed",
			cause: "self",
			error: createSerializableError(error),
		});
		return true;
	} catch (failErr) {
		if (failErr instanceof WorkflowRunStateUnknownError) {
			logger.warn("Workflow run state unknown while failing after a permanent codec error", {
				err: failErr,
			});
			return false;
		}
		logger.error("Failed to mark the workflow run as failed after a permanent codec error", {
			err: failErr,
		});
		return false;
	}
}
