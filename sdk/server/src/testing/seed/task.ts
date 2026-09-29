import { hashInput } from "@aikirun/lib/crypto";
import type { FakePublisher } from "@aikirun/testing/infra/queue";
import { asOpaquePayload } from "@aikirun/testing/payload";

import { type SeedRunDeps, type SeedRunOverrides, seedClaimedRun } from "./run";
import { createChildRunCanceller } from "../../service/cancel-child-runs";
import { discardStaleTasks } from "../../service/discard-stale-tasks";
import { createTaskStateMachine } from "../../service/state-machine/task";
import { createWorkflowRunStateMachine } from "../../service/state-machine/workflow-run";
import { withFakeClock } from "../clock";
import { namespaceRequestContextFactory } from "../data-factory/middleware/context";

const seededTask = {
	name: "reserve-inventory",
	input: { sku: "SKU-42", quantity: 3 },
	output: { reservationId: "rsv-1" },
} as const;

/**
 * Creates a running task on a run that is already claimed.
 * `latestTaskSequence` is the number of the latest task transition at `revisionWhenClaimed`, if there is one.
 */
export async function seedRunningTaskOnRun(
	deps: Pick<SeedRunDeps, "repos" | "namespaceRequestContext">,
	run: { runId: string; revisionWhenClaimed: number; latestTaskSequence?: number },
	params: { taskName: string; input: unknown }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const taskSequence = (run.latestTaskSequence ?? 0) + 1;

	const taskStateMachine = createTaskStateMachine({ repos });
	const taskInfo = await taskStateMachine.transitionState(namespaceRequestContext, {
		type: "create",
		workflowRunId: run.runId,
		expectedWorkflowRunRevision: run.revisionWhenClaimed,
		sequence: taskSequence,
		taskName: params.taskName,
		input: asOpaquePayload(params.input),
		inputHash: await hashInput(params.input),
	});

	return { taskInfo, taskInput: params.input, latestTaskSequence: taskSequence };
}

export async function seedRunningTask(deps: SeedRunDeps & { publisher: FakePublisher }, overrides?: SeedRunOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext }, overrides);

	const task = await seedRunningTaskOnRun({ repos, namespaceRequestContext }, seeded, {
		taskName: seededTask.name,
		input: seededTask.input,
	});

	return { ...seeded, ...task };
}

/** A run whose only task has been discarded, the way cancelling the run discards its tasks. */
export async function seedDiscardedTask(
	deps: SeedRunDeps & { publisher: FakePublisher },
	overrides?: SeedRunOverrides
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedRunningTask({ ...deps, namespaceRequestContext }, overrides);

	await repos.transaction((txRepos) =>
		discardStaleTasks([{ id: seeded.runId, revision: seeded.revisionWhenClaimed }], ["running"], txRepos)
	);

	return seeded;
}

/** An `awaiting_retry` task on a run that has not parked yet — the state between a task park and the run park. */
export async function seedAwaitingRetryTask(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params: { nextAttemptAt: number },
	overrides?: SeedRunOverrides
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedRunningTask({ ...deps, namespaceRequestContext }, overrides);

	const taskStateMachine = createTaskStateMachine({ repos });
	const taskSequence = seeded.latestTaskSequence + 1;
	// The transition takes a relative delay, so a frozen clock turns the authored absolute
	// due time into that delay. Frozen at 1, not 0: bun's setSystemTime treats the zero
	// timestamp as a reset to the real clock.
	const taskInfo = await withFakeClock(1, () =>
		taskStateMachine.transitionState(namespaceRequestContext, {
			id: seeded.taskInfo.id,
			workflowRunId: seeded.runId,
			expectedWorkflowRunRevision: seeded.revisionWhenClaimed,
			sequence: taskSequence,
			attempts: 1,
			state: {
				status: "awaiting_retry",
				error: { name: "Error", message: "inventory service unavailable" },
				nextAttemptInMs: params.nextAttemptAt - 1,
			},
		})
	);

	return { ...seeded, taskInfo, latestTaskSequence: taskSequence, nextAttemptAt: params.nextAttemptAt };
}

/**
 * Two `awaiting_retry` tasks on one running run.
 */
export async function seedSiblingAwaitingRetryTasks(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params: { firstNextAttemptAt: number; siblingNextAttemptAt: number }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedAwaitingRetryTask(
		{ ...deps, namespaceRequestContext },
		{ nextAttemptAt: params.firstNextAttemptAt }
	);

	const createdSibling = await seedRunningTaskOnRun({ repos, namespaceRequestContext }, seeded, {
		taskName: "charge-payment",
		input: { invoiceId: "inv-9" },
	});
	const taskStateMachine = createTaskStateMachine({ repos });
	const taskSequence = createdSibling.latestTaskSequence + 1;
	const siblingTaskInfo = await withFakeClock(1, () =>
		taskStateMachine.transitionState(namespaceRequestContext, {
			id: createdSibling.taskInfo.id,
			workflowRunId: seeded.runId,
			expectedWorkflowRunRevision: seeded.revisionWhenClaimed,
			sequence: taskSequence,
			attempts: 1,
			state: {
				status: "awaiting_retry",
				error: { name: "Error", message: "payment gateway unavailable" },
				nextAttemptInMs: params.siblingNextAttemptAt - 1,
			},
		})
	);

	return {
		...seeded,
		siblingTaskInfo,
		latestTaskSequence: taskSequence,
		siblingNextAttemptAt: params.siblingNextAttemptAt,
	};
}

/** A run parked as `awaiting_task_retry`, with one `awaiting_retry` task carrying the deadline. */
export async function seedAwaitingTaskRetryRun(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params: { nextAttemptAt: number },
	overrides?: SeedRunOverrides
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedAwaitingRetryTask(
		{ ...deps, namespaceRequestContext },
		{ nextAttemptAt: params.nextAttemptAt },
		overrides
	);

	const workflowRunStateMachine = createWorkflowRunStateMachine({
		repos,
		childRunCanceller: createChildRunCanceller(),
	});
	const parked = await workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "optimistic",
		id: seeded.runId,
		state: { status: "awaiting_task_retry" },
		expectedRevision: seeded.revisionWhenClaimed,
	});

	return { ...seeded, revisionWhenParked: parked.revision };
}

export async function seedCompletedTask(
	deps: SeedRunDeps & { publisher: FakePublisher },
	overrides?: { output: unknown }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedRunningTask({ ...deps, namespaceRequestContext });

	const output = overrides ? overrides.output : seededTask.output;

	const taskStateMachine = createTaskStateMachine({ repos });
	const taskSequence = seeded.latestTaskSequence + 1;
	const taskInfo = await taskStateMachine.transitionState(namespaceRequestContext, {
		id: seeded.taskInfo.id,
		workflowRunId: seeded.runId,
		expectedWorkflowRunRevision: seeded.revisionWhenClaimed,
		sequence: taskSequence,
		attempts: 1,
		state: { status: "completed", output: asOpaquePayload(output) },
	});

	return { ...seeded, taskInfo, latestTaskSequence: taskSequence, taskOutput: output };
}
