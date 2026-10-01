import type { TimestampMs } from "@aikirun/lib/timestamp";
import { asOpaquePayload } from "@aikirun/testing/payload";

import { describe, expect, test } from "bun:test";
import { createChildRunCanceller } from "../../../service/cancel-child-runs";
import { createWorkflowRunStateMachine } from "../../../service/state-machine/workflow-run";
import { withFakeClock } from "../../../testing/clock";
import { createServiceHarness, type ServiceHarnessDeps } from "../../../testing/harness";
import { seedClaimedRun } from "../../../testing/seed/run";

const withHarness = createServiceHarness();

const ONE_MINUTE = 60_000;

function seedClaimedChildRun(
	deps: Pick<ServiceHarnessDeps, "context" | "repos" | "publisher">,
	parent: { runId: string; revisionWhenClaimed: number }
) {
	const { context, repos, publisher } = deps;
	return seedClaimedRun(
		{ namespaceRequestContext: context, repos, publisher },
		{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
	);
}

/** Completes a child with the authored output; the transition writes the parent's wait row. */
async function completeChildRun(
	deps: Pick<ServiceHarnessDeps, "context" | "repos">,
	params: { runId: string; expectedRevision: number; output: unknown }
): Promise<void> {
	const { context, repos } = deps;
	const stateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller: createChildRunCanceller() });
	await stateMachine.transitionState(context, {
		type: "optimistic",
		id: params.runId,
		state: { status: "completed", output: asOpaquePayload(params.output) },
		expectedRevision: params.expectedRevision,
	});
}

describe("child workflow run wait repository listByParentRunIdWithChildState", () => {
	test("lists the parent's waits in id order with each child's state", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { context, repos, publisher };
			const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const firstChild = await seedClaimedChildRun(deps, parent);
			const secondChild = await seedClaimedChildRun(deps, parent);
			const otherParent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const otherChild = await seedClaimedChildRun(deps, otherParent);
			await completeChildRun(deps, {
				runId: otherChild.runId,
				expectedRevision: otherChild.revisionWhenClaimed,
				output: { receiptId: "rcp-9" },
			});

			const base = Date.now();
			await withFakeClock(base, () =>
				completeChildRun(deps, {
					runId: firstChild.runId,
					expectedRevision: firstChild.revisionWhenClaimed,
					output: { receiptId: "rcp-1" },
				})
			);
			await withFakeClock(base + ONE_MINUTE, () =>
				completeChildRun(deps, {
					runId: secondChild.runId,
					expectedRevision: secondChild.revisionWhenClaimed,
					output: { receiptId: "rcp-2" },
				})
			);

			expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parent.runId)).toEqual([
				expect.objectContaining({
					parentWorkflowRunId: parent.runId,
					childWorkflowRunId: firstChild.runId,
					status: "completed",
					completedAt: base,
					timedOutAt: null,
					childWorkflowRunStatus: "completed",
					signalSequence: 1,
					childWorkflowRunState: { status: "completed", output: { receiptId: "rcp-1" } },
				}),
				expect.objectContaining({
					parentWorkflowRunId: parent.runId,
					childWorkflowRunId: secondChild.runId,
					status: "completed",
					completedAt: base + ONE_MINUTE,
					timedOutAt: null,
					childWorkflowRunStatus: "completed",
					signalSequence: 2,
					childWorkflowRunState: { status: "completed", output: { receiptId: "rcp-2" } },
				}),
			]);
		}));

	test("a completed child's state carries the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { context, repos, publisher };
			const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const child = await seedClaimedChildRun(deps, parent);
			await completeChildRun(deps, {
				runId: child.runId,
				expectedRevision: child.revisionWhenClaimed,
				output: undefined,
			});

			const waits = await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parent.runId);

			const childState = waits.find((wait) => wait.childWorkflowRunId === child.runId)?.childWorkflowRunState;
			expect(childState).toHaveProperty("output");
			expect(childState).toEqual({ status: "completed", output: undefined });
		}));

	test("a wait without a child transition has no child state", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { context, repos, publisher };
			const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const child = await seedClaimedChildRun(deps, parent);
			const timedOutAt = 1_000_000 as TimestampMs;
			await repos.childWorkflowRunWait.insert({
				id: "01-timed-out-wait",
				parentWorkflowRunId: parent.runId,
				childWorkflowRunId: child.runId,
				status: "timeout",
				timedOutAt,
			});

			expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parent.runId)).toEqual([
				expect.objectContaining({
					id: "01-timed-out-wait",
					parentWorkflowRunId: parent.runId,
					childWorkflowRunId: child.runId,
					status: "timeout",
					timedOutAt,
					completedAt: null,
					childWorkflowRunState: null,
					childWorkflowRunStatus: null,
					childWorkflowRunStateTransitionId: null,
					signalSequence: null,
				}),
			]);
		}));
});
