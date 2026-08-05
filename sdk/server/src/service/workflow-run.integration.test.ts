import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunService } from "../service/workflow-run";
import { createWorkflowRunStateMachineService } from "../service/workflow-run-state-machine";
import { withFakeClock } from "../testing/clock";
import { createServiceHarness } from "../testing/harness";
import { seedClaimedRun } from "../testing/run-seed";

const withHarness = createServiceHarness();

function createService(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachineService = createWorkflowRunStateMachineService({ repos, childRunCanceller });
	return {
		service: createWorkflowRunService({ repos, childRunCanceller, workflowRunStateMachineService }),
		stateMachine: workflowRunStateMachineService,
	};
}

describe("WorkflowRunService cancelByIds", () => {
	test("cancelling a sleeping run cancels its active sleep", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const { service, stateMachine } = createService(repos);
			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
				expectedRevision: revisionWhenClaimed,
			});

			const cancelledAt = Date.now();
			const result = await withFakeClock(cancelledAt, () => service.cancelByIds(context, { ids: [runId] }));
			expect(result).toEqual({ cancelledIds: [runId] });

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "cancelled",
					state: { status: "cancelled", reason: "Cancelled" },
				})
			);

			const sleeps = await repos.sleep.listByWorkflowRunId(runId);
			expect(sleeps).toEqual([expect.objectContaining({ name: "nap", status: "cancelled", cancelledAt })]);
		}));
});
