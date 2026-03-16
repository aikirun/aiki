import { hashInput, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	NON_TERMINAL_WORKFLOW_RUN_STATUSES,
	type WorkflowRunId,
	type WorkflowRunStateScheduled,
	type WorkflowStartOptions,
} from "@aikirun/types/workflow-run";
import type { DbTransaction } from "server/infra/db";
import type { StateTransitionRepository, StateTransitionRowInsert } from "server/infra/db/repository/state-transition";
import type { WorkflowRepository, WorkflowRowInsert } from "server/infra/db/repository/workflow";
import type { WorkflowRunRepository, WorkflowRunRowInsert } from "server/infra/db/repository/workflow-run";
import type { Logger } from "server/infra/logger";
import { ulid } from "ulidx";

export interface ChildRunCancellerDeps {
	workflowRepo: WorkflowRepository;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
}

export interface CancelledParentRun {
	namespaceId: NamespaceId;
	runId: string;
	shard: string | undefined;
}

export function createChildRunCanceller(deps: ChildRunCancellerDeps) {
	return {
		async cancel(parentRuns: NonEmptyArray<CancelledParentRun>, tx: DbTransaction, logger: Logger): Promise<void> {
			if (!isNonEmptyArray(NON_TERMINAL_WORKFLOW_RUN_STATUSES)) {
				return;
			}

			const parentRunIds = parentRuns.map((r) => r.runId);
			const parentRunIdsHavingChildren = await deps.workflowRunRepo.hasChildRuns(
				parentRunIds as NonEmptyArray<string>,
				NON_TERMINAL_WORKFLOW_RUN_STATUSES,
				tx
			);
			if (parentRunIdsHavingChildren.size === 0) {
				return;
			}

			const parentRunsHavingChildren = parentRuns.filter((r) => parentRunIdsHavingChildren.has(r.runId));
			if (!isNonEmptyArray(parentRunsHavingChildren)) {
				return;
			}

			logger.info({ parentRunIds: parentRunIdsHavingChildren }, "Scheduling cancel-child-runs workflows");

			const workflowEntries: WorkflowRowInsert[] = [];
			const inputHashPromises: Array<Promise<string>> = [];
			const seenNamespaceIds = new Set<NamespaceId>();

			for (const { namespaceId, runId } of parentRunsHavingChildren) {
				if (!seenNamespaceIds.has(namespaceId)) {
					seenNamespaceIds.add(namespaceId);
					workflowEntries.push({
						namespaceId: namespaceId,
						name: "aiki:cancel-child-runs" as WorkflowName,
						versionId: "1.0.0" as WorkflowVersionId,
						source: "system",
					});
				}
				inputHashPromises.push(hashInput(runId));
			}
			if (!isNonEmptyArray(workflowEntries)) {
				return;
			}

			const workflows = await deps.workflowRepo.getOrCreateBulk(workflowEntries, tx);
			const workflowsByNamespaceId = new Map(workflows.map((w) => [w.namespaceId, w]));

			const now = Date.now();
			const inputHashes = await Promise.all(inputHashPromises);

			const workflowRunEntries: WorkflowRunRowInsert[] = [];
			const stateTransitionEntries: StateTransitionRowInsert[] = [];

			for (const [i, parentRun] of parentRunsHavingChildren.entries()) {
				const workflow = workflowsByNamespaceId.get(parentRun.namespaceId);
				const inputHash = inputHashes[i];
				if (!workflow || inputHash === undefined) {
					continue;
				}

				const childrenCancellationRunId = ulid() as WorkflowRunId;
				const cancellationRunStateTransitionId = ulid();

				workflowRunEntries.push({
					id: childrenCancellationRunId,
					namespaceId: parentRun.namespaceId,
					workflowId: workflow.id,
					status: "scheduled",
					input: parentRun.runId,
					inputHash,
					options: {
						shard: parentRun.shard,
						retry: {
							type: "exponential",
							maxAttempts: Number.MAX_SAFE_INTEGER,
							baseDelayMs: 1_000,
							maxDelayMs: 30_000,
						},
					} satisfies WorkflowStartOptions,
					latestStateTransitionId: cancellationRunStateTransitionId,
					scheduledAt: new Date(now),
				});

				stateTransitionEntries.push({
					id: cancellationRunStateTransitionId,
					workflowRunId: childrenCancellationRunId,
					type: "workflow_run",
					status: "scheduled",
					attempt: 0,
					state: {
						status: "scheduled",
						scheduledAt: now,
						reason: "new",
					} satisfies WorkflowRunStateScheduled,
				});
			}

			if (isNonEmptyArray(workflowRunEntries) && isNonEmptyArray(stateTransitionEntries)) {
				await deps.workflowRunRepo.insert(workflowRunEntries, tx);
				await deps.stateTransitionRepo.appendBatch(stateTransitionEntries, tx);
			}
		},
	};
}

export type ChildRunCanceller = ReturnType<typeof createChildRunCanceller>;
