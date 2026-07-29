import type { DaemonHarnessDeps } from "./daemon-harness";
import { namespaceRequestContextFactory } from "./middleware/context";
import { processImminentScheduledRuns } from "../daemons/imminent-scheduled-runs";
import { publishReadyRuns } from "../daemons/publish-ready-runs";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunService } from "../service/workflow-run";
import { createWorkflowRunStateMachineService } from "../service/workflow-run-state-machine";

export const namespaceContext = namespaceRequestContextFactory.build();

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

export async function seedQueuedRun(deps: DaemonHarnessDeps) {
	return _seedQueuedRun(deps, undefined);
}

export async function seedShardedQueuedRun(deps: DaemonHarnessDeps) {
	const shard = "warehouse-eu";
	const seeded = await _seedQueuedRun(deps, shard);
	return { ...seeded, shard };
}

async function _seedQueuedRun({ context, repos }: DaemonHarnessDeps, shard: string | undefined) {
	const services = createServices(repos);

	const runId = await services.workflowRun.createWorkflowRun(namespaceContext, {
		name: seededWorkflow.name,
		versionId: seededWorkflow.versionId,
		input: { orderId: "order-7" },
		options: shard ? { shard } : undefined,
	});

	await processImminentScheduledRuns(context, { repos }, { limit: 100, imminenceThresholdMs: 0, republishBackoff });

	const outboxRow = await repos.workflowRunOutbox.getByWorkflowRunId(namespaceContext.namespaceId, runId);
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

export async function claimRun(repos: Repositories, runId: string) {
	const services = createServices(repos);

	const run = await repos.workflowRun.getByIdWithState(namespaceContext.namespaceId, runId);
	if (!run) {
		throw new Error(`Run not found: ${runId}`);
	}

	const claim = await services.workflowRunStateMachine.transitionState(namespaceContext, {
		type: "optimistic",
		id: runId,
		state: { status: "running" },
		expectedRevision: run.revision,
	});

	return { revisionWhenClaimed: claim.revision, attemptsWhenClaimed: claim.attempts };
}

export async function seedClaimedRun(deps: DaemonHarnessDeps) {
	const { context, repos, publisher } = deps;
	const seeded = await seedQueuedRun(deps);

	await publishReadyRuns(context, { repos, workflowRunPublisher: publisher }, { limit: 100, republishBackoff });

	const claim = await claimRun(repos, seeded.runId);
	return { ...seeded, ...claim };
}

export async function seedPublishedRun(deps: DaemonHarnessDeps) {
	const { context, repos, publisher } = deps;
	const seeded = await seedQueuedRun(deps);

	await publishReadyRuns(context, { repos, workflowRunPublisher: publisher }, { limit: 100, republishBackoff });

	return seeded;
}
