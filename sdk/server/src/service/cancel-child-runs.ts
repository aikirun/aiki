import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import { hashInput } from "@aikirun/lib/crypto";
import type { Logger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	NON_TERMINAL_WORKFLOW_RUN_STATUSES,
	type WorkflowRunId,
	type WorkflowRunStateScheduled,
	type WorkflowStartOptions,
} from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { TxRepositories } from "../infra/db/types";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { WorkflowRowInsert } from "../infra/db/types/workflow";
import type { WorkflowRunRowInsert } from "../infra/db/types/workflow-run";

export interface CancelledRunMeta {
	namespaceId: NamespaceId;
	id: string;
	pool: string | undefined;
}

export const createChildRunCanceller = () => ({
	async cancel(runs: NonEmptyArray<CancelledRunMeta>, txRepos: TxRepositories, logger: Logger): Promise<void> {
		if (!isNonEmptyArray(NON_TERMINAL_WORKFLOW_RUN_STATUSES)) {
			return;
		}

		const runIdsHavingChildren = await txRepos.workflowRun.hasChildRuns(runs, NON_TERMINAL_WORKFLOW_RUN_STATUSES);
		if (runIdsHavingChildren.size === 0) {
			return;
		}

		const runsHavingChildren = runs.filter((run) => runIdsHavingChildren.has(run.id));
		if (!isNonEmptyArray(runsHavingChildren)) {
			return;
		}

		logger.info("Scheduling cancel-child-runs workflows", { "aiki.parentRunIds": runIdsHavingChildren });

		const workflowEntries: WorkflowRowInsert[] = [];
		const inputHashPromises: Array<Promise<string>> = [];
		const seenNamespaceIds = new Set<NamespaceId>();

		for (const { namespaceId, id: runId } of runsHavingChildren) {
			if (!seenNamespaceIds.has(namespaceId)) {
				seenNamespaceIds.add(namespaceId);
				workflowEntries.push({
					namespaceId: namespaceId,
					name: "cancel-child-runs" as WorkflowName,
					versionId: "1.0.0" as WorkflowVersionId,
					source: "system",
				});
			}
			inputHashPromises.push(hashInput(runId));
		}
		if (!isNonEmptyArray(workflowEntries)) {
			return;
		}

		const workflows = await txRepos.workflow.getOrCreateBulk(workflowEntries);
		const workflowsByNamespaceId = new Map(workflows.map((workflow) => [workflow.namespaceId, workflow]));

		const now = Date.now();
		const inputHashes = await Promise.all(inputHashPromises);

		const workflowRunEntries: WorkflowRunRowInsert[] = [];
		const stateTransitionEntries: StateTransitionRowInsert[] = [];

		for (const [i, parentRun] of runsHavingChildren.entries()) {
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
				input: parentRun.id,
				inputHash,
				options: {
					pool: parentRun.pool,
					retry: {
						type: "exponential",
						maxAttempts: Number.MAX_SAFE_INTEGER,
						baseDelayMs: 1_000,
						maxDelayMs: 30_000,
					},
				} satisfies WorkflowStartOptions,
				latestStateTransitionId: cancellationRunStateTransitionId,
				scheduledAt: now as TimestampMs,
			});

			stateTransitionEntries.push({
				id: cancellationRunStateTransitionId,
				workflowRunId: childrenCancellationRunId,
				type: "workflow_run",
				status: "scheduled",
				attempt: 1,
				state: {
					status: "scheduled",
					scheduledAt: now,
					reason: "new",
				} satisfies WorkflowRunStateScheduled,
			});
		}

		if (isNonEmptyArray(workflowRunEntries) && isNonEmptyArray(stateTransitionEntries)) {
			await txRepos.workflowRun.insert(workflowRunEntries);
			await txRepos.stateTransition.appendBatch(stateTransitionEntries);
		}
	},
});

export type ChildRunCanceller = ReturnType<typeof createChildRunCanceller>;
