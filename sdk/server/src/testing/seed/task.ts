import { hashInput } from "@aikirun/lib/crypto";
import type { FakePublisher } from "@aikirun/testing/infra/queue";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { TaskStatus } from "@aikirun/types/workflow/task";

import { type SeedRunDeps, type SeedRunOverrides, seedClaimedRun } from "./run";
import { recoverOverdueOutboxEntries } from "../../daemon/recover-overdue-outbox-entries";
import { createChildRunCanceller } from "../../service/cancel-child-runs";
import { discardStaleTasks } from "../../service/discard-stale-tasks";
import { createTaskStateMachine } from "../../service/state-machine/task";
import { createWorkflowRunStateMachine } from "../../service/state-machine/workflow-run";
import { withFakeClock } from "../clock";
import { daemonContextFactory, namespaceRequestContextFactory } from "../data-factory/middleware/context";

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

/**
 * Creates one task in each status an attempt can leave behind, `running`, `awaiting_retry`, `completed` and
 * `failed`, on a run that is already claimed.
 */
export async function seedTaskInEachStatusOnRun(
	deps: Pick<SeedRunDeps, "repos" | "namespaceRequestContext">,
	run: { runId: string; revisionWhenClaimed: number }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();

	const runningTask = await seedRunningTaskOnRun({ repos, namespaceRequestContext }, run, {
		taskName: seededTask.name,
		input: seededTask.input,
	});
	const taskToRetry = await seedRunningTaskOnRun(
		{ repos, namespaceRequestContext },
		{ ...run, latestTaskSequence: runningTask.latestTaskSequence },
		{ taskName: "charge-payment", input: { invoiceId: "inv-9" } }
	);
	const taskToComplete = await seedRunningTaskOnRun(
		{ repos, namespaceRequestContext },
		{ ...run, latestTaskSequence: taskToRetry.latestTaskSequence },
		{ taskName: "book-courier", input: { parcelId: "pcl-5" } }
	);
	const taskToFail = await seedRunningTaskOnRun(
		{ repos, namespaceRequestContext },
		{ ...run, latestTaskSequence: taskToComplete.latestTaskSequence },
		{ taskName: "send-receipt", input: { receiptId: "rcp-3" } }
	);

	const taskStateMachine = createTaskStateMachine({ repos });
	await taskStateMachine.transitionState(namespaceRequestContext, {
		id: taskToRetry.taskInfo.id,
		workflowRunId: run.runId,
		expectedWorkflowRunRevision: run.revisionWhenClaimed,
		sequence: taskToFail.latestTaskSequence + 1,
		attempts: 1,
		state: {
			status: "awaiting_retry",
			error: { name: "Error", message: "payment gateway unavailable" },
			nextAttemptInMs: 60_000,
		},
	});
	await taskStateMachine.transitionState(namespaceRequestContext, {
		id: taskToComplete.taskInfo.id,
		workflowRunId: run.runId,
		expectedWorkflowRunRevision: run.revisionWhenClaimed,
		sequence: taskToFail.latestTaskSequence + 2,
		attempts: 1,
		state: { status: "completed", output: asOpaquePayload({ trackingId: "trk-8" }) },
	});
	await taskStateMachine.transitionState(namespaceRequestContext, {
		id: taskToFail.taskInfo.id,
		workflowRunId: run.runId,
		expectedWorkflowRunRevision: run.revisionWhenClaimed,
		sequence: taskToFail.latestTaskSequence + 3,
		attempts: 1,
		state: { status: "failed", error: { name: "Error", message: "mail server rejected the receipt" } },
	});

	return {
		latestTaskSequence: taskToFail.latestTaskSequence + 3,
		taskIdByStatus: {
			running: runningTask.taskInfo.id,
			awaiting_retry: taskToRetry.taskInfo.id,
			completed: taskToComplete.taskInfo.id,
			failed: taskToFail.taskInfo.id,
		} satisfies Record<Exclude<TaskStatus, "discarded">, string>,
	};
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

/** An `awaiting_retry` task on a run that is not suspended yet — the state between the task's retry and the run's suspension. */
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

/** A run suspended in `awaiting_task_retry`, with one `awaiting_retry` task carrying the deadline. */
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
	const suspendedRun = await workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "optimistic",
		id: seeded.runId,
		state: { status: "awaiting_task_retry" },
		expectedRevision: seeded.revisionWhenClaimed,
	});

	return { ...seeded, revisionWhenSuspended: suspendedRun.revision };
}

/**
 * A run in `awaiting_retry` because one of its tasks failed, with a sibling task left in each other
 * status an attempt can leave behind: `running`, `awaiting_retry` and `completed`.
 */
export async function seedAwaitingRetryRunAfterTaskFailure(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params: { nextAttemptAt: number }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext });
	const { taskIdByStatus } = await seedTaskInEachStatusOnRun({ repos, namespaceRequestContext }, seeded);

	const workflowRunStateMachine = createWorkflowRunStateMachine({
		repos,
		childRunCanceller: createChildRunCanceller(),
	});
	// The transition takes a relative delay, so a frozen clock turns the authored absolute
	// due time into that delay. Frozen at 1, not 0: bun's setSystemTime treats the zero
	// timestamp as a reset to the real clock.
	const suspendedRun = await withFakeClock(1, () =>
		workflowRunStateMachine.transitionState(namespaceRequestContext, {
			type: "optimistic",
			id: seeded.runId,
			state: {
				status: "awaiting_retry",
				cause: "task",
				taskId: taskIdByStatus.failed,
				nextAttemptInMs: params.nextAttemptAt - 1,
			},
			expectedRevision: seeded.revisionWhenClaimed,
		})
	);

	return {
		...seeded,
		nextAttemptAt: params.nextAttemptAt,
		revisionWhenSuspended: suspendedRun.revision,
		taskIdByStatus,
	};
}

/**
 * A run put back to `queued` by recovery after its worker's claim went stale, with the tasks that
 * worker left behind: one each `running`, `awaiting_retry`, `completed` and `failed`.
 */
export async function seedRecoveredRun(deps: SeedRunDeps & { publisher: FakePublisher }) {
	const { repos } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext });
	const { taskIdByStatus } = await seedTaskInEachStatusOnRun({ repos, namespaceRequestContext }, seeded);

	// -1 makes the claim stale by arithmetic, so recovery takes it back without waiting.
	await recoverOverdueOutboxEntries(
		daemonContext,
		{ repos },
		{ claimIdleTimeoutMs: -1, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
	);
	const recoveredRun = await repos.workflowRun.getById({
		namespaceId: namespaceRequestContext.namespaceId,
		id: seeded.runId,
	});
	if (recoveredRun?.status !== "queued") {
		throw new Error(`Recovery did not put run ${seeded.runId} back to queued`);
	}

	return {
		...seeded,
		revisionWhenRecovered: recoveredRun.revision,
		taskIdByStatus,
	};
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
