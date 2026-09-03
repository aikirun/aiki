import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/data-factory/workflow/run";
import { completedTaskInfoFactory, runningTaskInfoFactory } from "@aikirun/testing/data-factory/workflow/task";
import type { Client } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import { NON_TERMINAL_WORKFLOW_RUN_STATUSES } from "@aikirun/types/workflow/run";

import { createCancelChildRunsV1 } from "./cancel-child-runs";
import { describe, expect, test } from "bun:test";
import type { WorkflowRun } from "../run";
import { workflowRunHandle } from "../run/handle";
import { createReplayManifest } from "../run/replay-manifest";
import { taskExecutionTracker } from "../run/task-execution-tracker";

const LIST_NON_TERMINAL_CHILDREN_TASK_NAME = "list-non-terminal-child-runs";
const CANCEL_RUNS_TASK_NAME = "cancel-runs";

function createTestWorkflowRun(
	client: Client,
	record: WorkflowRunRecord
): WorkflowRun<unknown, null, Record<string, never>> {
	const handle = workflowRunHandle(client, record);
	return {
		id: record.id as WorkflowRunId,
		name: record.name as WorkflowName,
		versionId: record.versionId as WorkflowVersionId,
		options: record.options ?? {},
		logger: client.logger,
		sleep: () => {
			throw new Error("sleep is not used in these unit tests");
		},
		events: {},
		context: null,
		[INTERNAL]: {
			handle,
			replayManifest: createReplayManifest(record),
			createTaskExecutionTracker: taskExecutionTracker(handle, client.logger).create,
			configProvider: asConfigProvider(() => ({ claimRefreshIntervalMs: 30_000, maxInlineWaitMs: 10 })),
			hasher: hashInput,
		},
	};
}

describe("createCancelChildRunsV1", () => {
	test("lists the parent's non-terminal child runs and cancels exactly those", () =>
		withFakeClient(async (client) => {
			const runRecord = runningWorkflowRunRecordFactory.build();
			const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<string, null, Record<string, never>>;
			const canceChildRunsV1 = createCancelChildRunsV1(client.api);

			const parentRunId = "parent-run-1";
			const nonTerminalChildRunIds = ["child-run-1", "child-run-2"];
			const parentRunIdInputHash = await hashInput(parentRunId);
			const nonTerminalChildRunIdsInputHash = await hashInput(nonTerminalChildRunIds);

			const runningListNonTerminalChildrenTask = runningTaskInfoFactory.build({
				name: LIST_NON_TERMINAL_CHILDREN_TASK_NAME,
			});
			const completedListNonTerminalChildrenTask = completedTaskInfoFactory.build({
				id: runningListNonTerminalChildrenTask.id,
				name: runningListNonTerminalChildrenTask.name,
				state: { output: nonTerminalChildRunIds },
			});
			const runningCancelRunsTask = runningTaskInfoFactory.build({
				name: CANCEL_RUNS_TASK_NAME,
			});
			const completedCancelRunsTask = completedTaskInfoFactory.build({
				id: runningCancelRunsTask.id,
				name: runningCancelRunsTask.name,
				state: { output: nonTerminalChildRunIds },
			});

			client.api.workflowRun.transitionStateV1
				.once(
					{
						type: "optimistic",
						id: runRecord.id,
						state: { status: "running" },
						expectedRevision: runRecord.revision,
					},
					{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
				)
				.once(
					{
						type: "optimistic",
						id: runRecord.id,
						state: { status: "completed", output: undefined },
						expectedRevision: runRecord.revision,
					},
					{
						revision: runRecord.revision,
						state: { status: "completed", output: undefined },
						attempts: runRecord.attempts,
					}
				);

			client.api.task.transitionStateV1
				.once(
					{
						type: "create",
						input: parentRunId,
						inputHash: parentRunIdInputHash,
						taskName: runningListNonTerminalChildrenTask.name,
						options: {},
						workflowRunId: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: runningListNonTerminalChildrenTask }
				)
				.once(
					{
						id: runningListNonTerminalChildrenTask.id,
						attempts: 1,
						state: completedListNonTerminalChildrenTask.state,
						workflowRunId: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: completedListNonTerminalChildrenTask }
				)
				.once(
					{
						type: "create",
						input: nonTerminalChildRunIds,
						inputHash: nonTerminalChildRunIdsInputHash,
						taskName: runningCancelRunsTask.name,
						options: {},
						workflowRunId: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: runningCancelRunsTask }
				)
				.once(
					{
						id: runningCancelRunsTask.id,
						attempts: 1,
						state: completedCancelRunsTask.state,
						workflowRunId: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: completedCancelRunsTask }
				);

			client.api.workflowRun.listChildRunsV1.once(
				{ id: parentRunId, childRunStatus: NON_TERMINAL_WORKFLOW_RUN_STATUSES },
				{ runs: nonTerminalChildRunIds.map((id) => ({ id })) }
			);
			client.api.workflowRun.cancelByIdsV1.once(
				{ ids: nonTerminalChildRunIds },
				{ cancelledIds: nonTerminalChildRunIds }
			);

			expect(canceChildRunsV1[INTERNAL].handler(run, parentRunId)).resolves.toBeUndefined();
		}));

	test("does not cancel anything when the parent has no non-terminal children", () =>
		withFakeClient(async (client) => {
			const runRecord = runningWorkflowRunRecordFactory.build();
			const run = createTestWorkflowRun(client, runRecord) as WorkflowRun<string, null, Record<string, never>>;
			const canceChildRunsV1 = createCancelChildRunsV1(client.api);

			const parentRunId = "parent-run-1";
			const parentRunIdInputHash = await hashInput(parentRunId);

			const runningListNonTerminalChildrenTask = runningTaskInfoFactory.build({
				name: LIST_NON_TERMINAL_CHILDREN_TASK_NAME,
			});
			const completedListNonTerminalChildrenTask = completedTaskInfoFactory.build({
				id: runningListNonTerminalChildrenTask.id,
				name: runningListNonTerminalChildrenTask.name,
				state: { output: [] },
			});

			client.api.workflowRun.transitionStateV1
				.once(
					{
						type: "optimistic",
						id: runRecord.id,
						state: { status: "running" },
						expectedRevision: runRecord.revision,
					},
					{ revision: runRecord.revision, state: runRecord.state, attempts: runRecord.attempts }
				)
				.once(
					{
						type: "optimistic",
						id: runRecord.id,
						state: { status: "completed", output: undefined },
						expectedRevision: runRecord.revision,
					},
					{
						revision: runRecord.revision,
						state: { status: "completed", output: undefined },
						attempts: runRecord.attempts,
					}
				);

			client.api.task.transitionStateV1
				.once(
					{
						type: "create",
						input: parentRunId,
						inputHash: parentRunIdInputHash,
						taskName: runningListNonTerminalChildrenTask.name,
						options: {},
						workflowRunId: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: runningListNonTerminalChildrenTask }
				)
				.once(
					{
						id: runningListNonTerminalChildrenTask.id,
						attempts: 1,
						state: completedListNonTerminalChildrenTask.state,
						workflowRunId: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: completedListNonTerminalChildrenTask }
				);

			client.api.workflowRun.listChildRunsV1.once(
				{ id: parentRunId, childRunStatus: NON_TERMINAL_WORKFLOW_RUN_STATUSES },
				{ runs: [] }
			);

			expect(canceChildRunsV1[INTERNAL].handler(run, parentRunId)).resolves.toBeUndefined();
		}));
});
