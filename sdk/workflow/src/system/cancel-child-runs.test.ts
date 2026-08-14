import { asConfigProvider } from "@aikirun/lib/config";
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
			configProvider: asConfigProvider(() => ({ claimRefreshIntervalMs: 30_000, maxInlineWaitMs: 10 })),
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

			client.api.workflowRun.transitionTaskStateV1
				.once(
					{
						type: "create",
						input: parentRunId,
						taskName: runningListNonTerminalChildrenTask.name,
						options: {},
						taskState: { status: runningListNonTerminalChildrenTask.state.status },
						id: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: runningListNonTerminalChildrenTask }
				)
				.once(
					{
						taskId: runningListNonTerminalChildrenTask.id,
						taskState: completedListNonTerminalChildrenTask.state,
						id: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: completedListNonTerminalChildrenTask }
				)
				.once(
					{
						type: "create",
						input: nonTerminalChildRunIds,
						taskName: runningCancelRunsTask.name,
						options: {},
						taskState: { status: runningCancelRunsTask.state.status },
						id: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: runningCancelRunsTask }
				)
				.once(
					{
						taskId: runningCancelRunsTask.id,
						taskState: completedCancelRunsTask.state,
						id: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: completedCancelRunsTask }
				);

			client.api.workflowRun.listChildRunsV1.once(
				{ parentRunId, status: NON_TERMINAL_WORKFLOW_RUN_STATUSES },
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

			client.api.workflowRun.transitionTaskStateV1
				.once(
					{
						type: "create",
						input: parentRunId,
						taskName: runningListNonTerminalChildrenTask.name,
						options: {},
						taskState: { status: runningListNonTerminalChildrenTask.state.status },
						id: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: runningListNonTerminalChildrenTask }
				)
				.once(
					{
						taskId: runningListNonTerminalChildrenTask.id,
						taskState: completedListNonTerminalChildrenTask.state,
						id: runRecord.id,
						expectedWorkflowRunRevision: runRecord.revision,
					},
					{ taskInfo: completedListNonTerminalChildrenTask }
				);

			client.api.workflowRun.listChildRunsV1.once(
				{ parentRunId, status: NON_TERMINAL_WORKFLOW_RUN_STATUSES },
				{ runs: [] }
			);

			expect(canceChildRunsV1[INTERNAL].handler(run, parentRunId)).resolves.toBeUndefined();
		}));
});
