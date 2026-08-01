import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { FakePublisher } from "@aikirun/testing/infra/queue";

import { withFakeClock } from "./clock";
import { daemonContextFactory, namespaceRequestContextFactory } from "./middleware/context";
import { processImminentScheduledRuns } from "../daemons/imminent-scheduled-runs";
import { publishReadyRuns } from "../daemons/publish-ready-runs";
import { stallUndeliverableRuns } from "../daemons/stall-undeliverable-runs";
import type { Repositories } from "../infra/db/types";
import type { DaemonContext, NamespaceRequestContext } from "../middleware/context";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunService } from "../service/workflow-run";
import { createWorkflowRunStateMachineService } from "../service/workflow-run-state-machine";

const seededWorkflow = { name: "ship-orders", versionId: "v2" };

const republishBackoff = { baseDelayMs: 5_000, maxDelayMs: 300_000 };

function createServices(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachine = createWorkflowRunStateMachineService({ repos, childRunCanceller });
	const workflowRun = createWorkflowRunService({
		repos,
		childRunCanceller,
		workflowRunStateMachineService: workflowRunStateMachine,
	});
	return { workflowRun, workflowRunStateMachine };
}

interface SeedQueuedRunDeps {
	repos: Repositories;
	daemonContext?: DaemonContext;
	namespaceRequestContext?: NamespaceRequestContext;
}

export async function seedQueuedRun(deps: SeedQueuedRunDeps) {
	return _seedQueuedRun(deps, undefined);
}

export async function seedShardedQueuedRun(deps: SeedQueuedRunDeps) {
	const shard = "warehouse-eu";
	const seeded = await _seedQueuedRun(deps, shard);
	return { ...seeded, shard };
}

async function _seedQueuedRun(deps: SeedQueuedRunDeps, shard: string | undefined) {
	const { repos } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const services = createServices(repos);

	const runId = await services.workflowRun.createWorkflowRun(namespaceRequestContext, {
		name: seededWorkflow.name,
		versionId: seededWorkflow.versionId,
		input: { orderId: "order-7" },
		options: shard ? { shard } : undefined,
	});

	await processImminentScheduledRuns(daemonContext, { repos }, { limit: 100, lookaheadWindowMs: 0, republishBackoff });

	const outboxRow = await repos.workflowRunOutbox.getByWorkflowRunId(namespaceRequestContext.namespaceId, runId);
	if (!outboxRow) {
		throw new Error(`Outbox row not found for run: ${runId}`);
	}

	return {
		runId,
		outboxRowId: outboxRow.id,
		workflowName: seededWorkflow.name,
		workflowVersionId: seededWorkflow.versionId,
	};
}

export async function claimRun(deps: { context: NamespaceRequestContext; repos: Repositories; runId: string }) {
	const { context, repos, runId } = deps;
	const services = createServices(repos);

	const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
	if (!run) {
		throw new Error(`Run not found: ${runId}`);
	}

	const claim = await services.workflowRunStateMachine.transitionState(context, {
		type: "optimistic",
		id: runId,
		state: { status: "running" },
		expectedRevision: run.revision,
	});

	return { revisionWhenClaimed: claim.revision, attemptsWhenClaimed: claim.attempts };
}

export async function seedClaimedRun(deps: SeedQueuedRunDeps & { publisher: FakePublisher }) {
	const { repos, publisher } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedQueuedRun(deps);

	await publishReadyRuns(daemonContext, { repos, workflowRunPublisher: publisher }, { limit: 100, republishBackoff });

	const claim = await claimRun({ context: namespaceRequestContext, repos, runId: seeded.runId });
	return { ...seeded, ...claim };
}

export async function seedPublishedRun(deps: SeedQueuedRunDeps & { publisher: FakePublisher }) {
	const { repos, publisher } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const seeded = await seedQueuedRun(deps);

	await publishReadyRuns(daemonContext, { repos, workflowRunPublisher: publisher }, { limit: 100, republishBackoff });

	return seeded;
}

export async function seedStalledRun(deps: SeedQueuedRunDeps) {
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const seeded = await withFakeClock(1 as TimestampMs, () => seedQueuedRun(deps));

	await stallUndeliverableRuns(daemonContext, { repos: deps.repos }, { maxAgeMs: 60_000, limit: 100 });

	return { runId: seeded.runId, workflowName: seeded.workflowName, workflowVersionId: seeded.workflowVersionId };
}
