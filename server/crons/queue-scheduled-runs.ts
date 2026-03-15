import { chunkLazy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type {
	WorkflowRunScheduledReason,
	WorkflowRunState,
	WorkflowRunStateQueued,
	WorkflowStartOptions,
} from "@aikirun/types/workflow-run";
import type { DatabaseConn } from "server/infra/db";
import type { StateTransitionRepository, StateTransitionRowInsert } from "server/infra/db/repository/state-transition";
import type { WorkflowRepository } from "server/infra/db/repository/workflow";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import type {
	WorkflowRunOutboxRepository,
	WorkflowRunOutboxRowInsert,
} from "server/infra/db/repository/workflow-run-outbox";
import { runConcurrently } from "server/lib/concurrency";
import type { CronContext } from "server/middleware/context";
import { ulid } from "ulidx";

export interface QueueScheduledRunsDeps {
	db: DatabaseConn;
	workflowRunRepo: WorkflowRunRepository;
	workflowRepo: WorkflowRepository;
	stateTransitionRepo: StateTransitionRepository;
	workflowRunOutboxRepo: WorkflowRunOutboxRepository;
}

export async function queueScheduledWorkflowRuns(
	context: CronContext,
	deps: QueueScheduledRunsDeps,
	options?: { limit?: number; chunkSize?: number }
) {
	const { limit = 100, chunkSize = 50 } = options ?? {};

	const dueRuns = await deps.workflowRunRepo.listDueScheduleRuns(limit);
	if (!isNonEmptyArray(dueRuns)) {
		return;
	}

	const stateTransitionIds = dueRuns.map((run) => run.latestStateTransitionId);
	const workflowIds = Array.from(new Set(dueRuns.map((run) => run.workflowId)));
	if (!isNonEmptyArray(stateTransitionIds) || !isNonEmptyArray(workflowIds)) {
		return;
	}

	const [stateTransitions, workflows] = await Promise.all([
		deps.stateTransitionRepo.getByIds(stateTransitionIds),
		deps.workflowRepo.getByIdsGlobal(workflowIds),
	]);

	const stateTransitionsById = new Map(stateTransitions.map((transition) => [transition.id, transition]));
	const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

	const enrichedRuns: EnrichedWorkflowRun[] = [];
	for (const run of dueRuns) {
		const transition = stateTransitionsById.get(run.latestStateTransitionId);
		if (!transition) {
			context.logger.warn(
				{ runId: run.id, transitionId: run.latestStateTransitionId },
				"State transition not found, skipping"
			);
			continue;
		}
		const state = transition.state as WorkflowRunState;
		if (state.status !== "scheduled") {
			continue;
		}
		const workflow = workflowsById.get(run.workflowId);
		if (!workflow) {
			context.logger.warn({ runId: run.id, workflowId: run.workflowId }, "Workflow not found, skipping");
			continue;
		}

		const shard = (run.options as WorkflowStartOptions | null)?.shard;
		enrichedRuns.push({
			id: run.id,
			namespaceId: run.namespaceId,
			revision: run.revision,
			attempts: run.attempts,
			reason: state.reason,
			workflowName: workflow.name,
			workflowVersionId: workflow.versionId,
			shard,
		});
	}

	if (!isNonEmptyArray(enrichedRuns)) {
		return;
	}

	await runConcurrently(context, chunkLazy(enrichedRuns, chunkSize), async (chunk, spanCtx) => {
		try {
			await processChunk(spanCtx, deps, chunk);
		} catch (error) {
			spanCtx.logger.warn({ err: error, chunkSize: chunk.length }, "Failed to process chunk, will retry next tick");
		}
	});
}

interface EnrichedWorkflowRun {
	id: string;
	namespaceId: string;
	revision: number;
	attempts: number;
	reason: WorkflowRunScheduledReason;
	workflowName: string;
	workflowVersionId: string;
	shard?: string;
}

async function processChunk(
	_context: CronContext,
	deps: QueueScheduledRunsDeps,
	runs: NonEmptyArray<EnrichedWorkflowRun>
) {
	const stateTransitionEntries: StateTransitionRowInsert[] = [];
	const workflowRunUpdates: { id: string; revision: number; stateTransitionId: string }[] = [];
	const outboxEntries: WorkflowRunOutboxRowInsert[] = [];

	for (const run of runs) {
		const stateTransitionId = ulid();
		const state: WorkflowRunStateQueued = { status: "queued", reason: run.reason };
		stateTransitionEntries.push({
			id: stateTransitionId,
			workflowRunId: run.id,
			type: "workflow_run",
			status: "queued",
			attempt: run.attempts,
			state,
		});
		workflowRunUpdates.push({
			id: run.id,
			revision: run.revision,
			stateTransitionId,
		});
		outboxEntries.push({
			id: ulid(),
			namespaceId: run.namespaceId,
			workflowRunId: run.id,
			workflowName: run.workflowName,
			workflowVersionId: run.workflowVersionId,
			shard: run.shard,
			status: "pending",
		});
	}

	if (!isNonEmptyArray(stateTransitionEntries) || !isNonEmptyArray(workflowRunUpdates)) {
		return;
	}

	await deps.db.transaction(async (tx) => {
		await deps.stateTransitionRepo.appendBatch(stateTransitionEntries, tx);
		const transitionedRunIds = await deps.workflowRunRepo.bulkTransitionToQueued(workflowRunUpdates, tx);
		const transitionedRunIdsSet = new Set(transitionedRunIds);
		const outboxEntriesToInsert = outboxEntries.filter((entry) => transitionedRunIdsSet.has(entry.workflowRunId));
		if (isNonEmptyArray(outboxEntriesToInsert)) {
			await deps.workflowRunOutboxRepo.createBatch(outboxEntriesToInsert, tx);
		}
	});
}
