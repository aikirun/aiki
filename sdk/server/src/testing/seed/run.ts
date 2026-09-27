import { hashInput } from "@aikirun/lib/crypto";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { FakePublisher } from "@aikirun/testing/infra/queue";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { WorkflowStartOptions } from "@aikirun/types/workflow/run";

import { defaultServerRuntimeConfig } from "../../config/runtime";
import { processImminentScheduledRuns } from "../../daemon/imminent-scheduled-runs";
import { publishPendingOutboxEntries } from "../../daemon/publish-pending-outbox-entries";
import { stallUndeliverableRuns } from "../../daemon/stall-undeliverable-runs";
import type { Repositories } from "../../infra/db/types";
import type { DaemonContext, NamespaceRequestContext } from "../../middleware/context";
import { createChildRunCanceller } from "../../service/cancel-child-runs";
import { createWorkflowRunStateMachine } from "../../service/state-machine/workflow-run";
import { createWorkflowRunService } from "../../service/workflow-run";
import { withFakeClock } from "../clock";
import { daemonContextFactory, namespaceRequestContextFactory } from "../data-factory/middleware/context";

const seededWorkflow = { source: "user", name: "ship-orders", versionId: "v2" } as const;

const seededRunOutput = { receiptId: "rcp-3" } as const;

const publishPendingOutboxEntriesDaemonConfig = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

function createServices(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller });
	const workflowRun = createWorkflowRunService({ repos, childRunCanceller });
	return { workflowRun, workflowRunStateMachine };
}

export interface SeedRunDeps {
	repos: Repositories;
	daemonContext?: DaemonContext;
	namespaceRequestContext?: NamespaceRequestContext;
}

export interface SeedRunOverrides {
	options?: WorkflowStartOptions;
	parent?: { workflowRunId: string; expectedRevision: number };
}

export async function seedPooledScheduledRun(deps: Pick<SeedRunDeps, "repos" | "namespaceRequestContext">) {
	const pool = "warehouse-eu";
	const seeded = await seedScheduledRun(deps, { options: { pool } });
	return { ...seeded, pool };
}

export async function seedScheduledRun(
	deps: Pick<SeedRunDeps, "repos" | "namespaceRequestContext">,
	overrides?: SeedRunOverrides
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const services = createServices(repos);

	const input = { orderId: "order-7" };
	const inputHash = await hashInput(input);
	const runId = await services.workflowRun.createWorkflowRun(namespaceRequestContext, {
		name: seededWorkflow.name,
		versionId: seededWorkflow.versionId,
		input: asOpaquePayload(input),
		inputHash: { value: inputHash },
		clientHasherApplied: false,
		clientCodecApplied: false,
		options: overrides?.options,
		parent: overrides?.parent,
	});

	return { runId, inputHash, revisionWhenScheduled: 0, attemptsWhenScheduled: 1 };
}

export async function seedPooledQueuedRun(deps: SeedRunDeps) {
	const pool = "warehouse-eu";
	const seeded = await seedQueuedRun(deps, { options: { pool } });
	return { ...seeded, pool };
}

export async function seedQueuedRun(deps: SeedRunDeps, overrides?: SeedRunOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();

	const { runId, inputHash } = await seedScheduledRun({ repos, namespaceRequestContext }, overrides);

	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();

	await processImminentScheduledRuns(
		daemonContext,
		{ repos },
		{
			pageSize: 100,
			lookaheadWindowMs: 0,
			republishBackoff: publishPendingOutboxEntriesDaemonConfig.republishBackoff,
			chunk: { size: 100, maxConcurrency: 10 },
		}
	);

	const outboxRow = await repos.workflowRunOutbox.getByWorkflowRunId({
		namespaceId: namespaceRequestContext.namespaceId,
		workflowRunId: runId,
	});
	if (!outboxRow) {
		throw new Error(`Outbox row not found for run: ${runId}`);
	}

	return {
		runId,
		inputHash,
		revisionWhenQueued: 1,
		attemptsWhenQueued: 1,
		outboxRowId: outboxRow.id,
		workflowSource: seededWorkflow.source,
		workflowName: seededWorkflow.name,
		workflowVersionId: seededWorkflow.versionId,
	};
}

export async function claimRun(deps: { context: NamespaceRequestContext; repos: Repositories; runId: string }) {
	const { context, repos, runId } = deps;
	const services = createServices(repos);

	const result = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
	if (!result) {
		throw new Error(`Run not found: ${runId}`);
	}

	const claim = await services.workflowRunStateMachine.transitionState(context, {
		type: "optimistic",
		id: runId,
		state: { status: "running" },
		expectedRevision: result.run.revision,
	});

	return { revisionWhenClaimed: claim.revision, attemptsWhenClaimed: claim.attempts };
}

export async function completeRun(deps: {
	context: NamespaceRequestContext;
	repos: Repositories;
	runId: string;
	expectedRevision: number;
}) {
	const { context, repos, runId, expectedRevision } = deps;
	const services = createServices(repos);

	const completion = await services.workflowRunStateMachine.transitionState(context, {
		type: "optimistic",
		id: runId,
		state: { status: "completed", output: asOpaquePayload(seededRunOutput) },
		expectedRevision,
	});

	return { revisionWhenCompleted: completion.revision };
}

export async function seedClaimedRun(deps: SeedRunDeps & { publisher: FakePublisher }, overrides?: SeedRunOverrides) {
	const { repos, publisher } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedQueuedRun(deps, overrides);

	await publishPendingOutboxEntries(daemonContext, { repos, publisher }, publishPendingOutboxEntriesDaemonConfig);

	const claim = await claimRun({ context: namespaceRequestContext, repos, runId: seeded.runId });
	return { ...seeded, ...claim };
}

export async function seedCompletedRun(
	deps: SeedRunDeps & { publisher: FakePublisher },
	overrides?: SeedRunOverrides & { output?: unknown }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext }, overrides);

	const output = overrides && "output" in overrides ? overrides.output : seededRunOutput;

	const services = createServices(repos);
	await services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "optimistic",
		id: seeded.runId,
		state: { status: "completed", output: asOpaquePayload(output) },
		expectedRevision: seeded.revisionWhenClaimed,
	});

	return { ...seeded, runOutput: output };
}

export async function seedPublishedRun(deps: SeedRunDeps & { publisher: FakePublisher }) {
	const { repos, publisher } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const seeded = await seedQueuedRun(deps);

	await publishPendingOutboxEntries(daemonContext, { repos, publisher }, publishPendingOutboxEntriesDaemonConfig);

	return seeded;
}

export async function seedAwaitingEventRun(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params: { eventName: string; timeoutInMs?: number }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext });

	const services = createServices(repos);
	const parked = await services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "optimistic",
		id: seeded.runId,
		state: { status: "awaiting_event", eventName: params.eventName, timeoutInMs: params.timeoutInMs },
		expectedRevision: seeded.revisionWhenClaimed,
		expectedSignalSequence: 0,
	});

	return { ...seeded, eventName: params.eventName, revisionWhenParked: parked.revision };
}

export async function seedSleepingRun(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params: { sleepName: string; durationMs: number }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext });

	const services = createServices(repos);
	const sleepStartedAt = Date.now() as TimestampMs;
	const asleep = await withFakeClock(sleepStartedAt, () =>
		services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
			type: "optimistic",
			id: seeded.runId,
			state: { status: "sleeping", sleepName: params.sleepName, durationMs: params.durationMs },
			expectedRevision: seeded.revisionWhenClaimed,
		})
	);

	return {
		...seeded,
		sleepName: params.sleepName,
		wakeupAt: (sleepStartedAt + params.durationMs) as TimestampMs,
		revisionWhenAsleep: asleep.revision,
	};
}

export async function seedStalledRun(deps: SeedRunDeps, overrides?: SeedRunOverrides) {
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const seeded = await withFakeClock(1 as TimestampMs, () => seedQueuedRun(deps, overrides));

	await stallUndeliverableRuns(
		daemonContext,
		{ repos: deps.repos },
		{ maxAgeMs: 60_000, pageSize: 100, chunk: { size: 100, maxConcurrency: 10 } }
	);

	return {
		runId: seeded.runId,
		revisionWhenStalled: seeded.revisionWhenQueued + 1,
		workflowSource: seeded.workflowSource,
		workflowName: seeded.workflowName,
		workflowVersionId: seeded.workflowVersionId,
	};
}

export async function seedPausedRun(deps: SeedRunDeps & { publisher: FakePublisher }, overrides?: SeedRunOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext }, overrides);

	const services = createServices(repos);
	const paused = await services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "pessimistic",
		id: seeded.runId,
		state: { status: "paused" },
	});

	return { ...seeded, revisionWhenPaused: paused.revision };
}

/** A run parked as `awaiting_retry` on its own error, due at the authored instant. */
export async function seedAwaitingRetryRun(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params: { nextAttemptAt: number },
	overrides?: SeedRunOverrides
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext }, overrides);

	const services = createServices(repos);
	// The transition takes a relative delay, so a frozen clock turns the authored absolute
	// due time into that delay. Frozen at 1, not 0: bun's setSystemTime treats the zero
	// timestamp as a reset to the real clock.
	const parked = await withFakeClock(1, () =>
		services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
			type: "optimistic",
			id: seeded.runId,
			state: {
				status: "awaiting_retry",
				cause: "self",
				error: { name: "Error", message: "inventory service unavailable" },
				nextAttemptInMs: params.nextAttemptAt - 1,
			},
			expectedRevision: seeded.revisionWhenClaimed,
		})
	);

	return { ...seeded, nextAttemptAt: params.nextAttemptAt, revisionWhenParked: parked.revision };
}

/** A running parent parked on one of its running children. */
export async function seedAwaitingChildRun(
	deps: SeedRunDeps & { publisher: FakePublisher },
	params?: { timeoutInMs?: number }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const parent = await seedClaimedRun({ ...deps, namespaceRequestContext });
	const child = await seedClaimedRun(
		{ ...deps, namespaceRequestContext },
		{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
	);

	const services = createServices(repos);
	const parked = await services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "optimistic",
		id: parent.runId,
		state: { status: "awaiting_child_workflow", childWorkflowRunId: child.runId, timeoutInMs: params?.timeoutInMs },
		expectedRevision: parent.revisionWhenClaimed,
		expectedSignalSequence: 0,
	});

	return { ...parent, child, revisionWhenParked: parked.revision };
}

export async function seedCancelledRun(deps: SeedRunDeps & { publisher: FakePublisher }, overrides?: SeedRunOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext }, overrides);

	const services = createServices(repos);
	const cancelled = await services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "pessimistic",
		id: seeded.runId,
		state: { status: "cancelled" },
	});

	return { ...seeded, revisionWhenCancelled: cancelled.revision };
}

export async function seedFailedRun(deps: SeedRunDeps & { publisher: FakePublisher }, overrides?: SeedRunOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext }, overrides);

	const services = createServices(repos);
	const failed = await services.workflowRunStateMachine.transitionState(namespaceRequestContext, {
		type: "optimistic",
		id: seeded.runId,
		state: { status: "failed", cause: "self", error: { name: "Error", message: "inventory service unavailable" } },
		expectedRevision: seeded.revisionWhenClaimed,
	});

	return { ...seeded, revisionWhenFailed: failed.revision };
}
