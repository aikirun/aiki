import { hashInput } from "@aikirun/lib/crypto";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { FakePublisher } from "@aikirun/testing/infra/queue";

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

const publishPendingOutboxEntriesDaemonConfig = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

function createServices(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller });
	const workflowRun = createWorkflowRunService({
		repos,
		childRunCanceller,
		workflowRunStateMachine,
	});
	return { workflowRun, workflowRunStateMachine };
}

export interface SeedRunDeps {
	repos: Repositories;
	daemonContext?: DaemonContext;
	namespaceRequestContext?: NamespaceRequestContext;
}

export async function seedScheduledRun(deps: Pick<SeedRunDeps, "repos" | "namespaceRequestContext">) {
	return _seedScheduledRun(deps, undefined);
}

export async function seedPooledScheduledRun(deps: Pick<SeedRunDeps, "repos" | "namespaceRequestContext">) {
	const pool = "warehouse-eu";
	const seeded = await _seedScheduledRun(deps, pool);
	return { ...seeded, pool };
}

async function _seedScheduledRun(
	deps: Pick<SeedRunDeps, "repos" | "namespaceRequestContext">,
	pool: string | undefined
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const services = createServices(repos);

	const input = { orderId: "order-7" };
	const runId = await services.workflowRun.createWorkflowRun(namespaceRequestContext, {
		name: seededWorkflow.name,
		versionId: seededWorkflow.versionId,
		input,
		inputHash: await hashInput(input),
		options: pool ? { pool } : undefined,
	});

	return { runId, revisionWhenScheduled: 0, attemptsWhenScheduled: 1 };
}

export async function seedQueuedRun(deps: SeedRunDeps) {
	return _seedQueuedRun(deps, undefined);
}

export async function seedPooledQueuedRun(deps: SeedRunDeps) {
	const pool = "warehouse-eu";
	const seeded = await _seedQueuedRun(deps, pool);
	return { ...seeded, pool };
}

async function _seedQueuedRun(deps: SeedRunDeps, pool: string | undefined) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();

	const { runId } = await _seedScheduledRun({ repos, namespaceRequestContext }, pool);

	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();

	await processImminentScheduledRuns(
		daemonContext,
		{ repos },
		{ limit: 100, lookaheadWindowMs: 0, republishBackoff: publishPendingOutboxEntriesDaemonConfig.republishBackoff }
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

export async function seedClaimedRun(deps: SeedRunDeps & { publisher: FakePublisher }) {
	const { repos, publisher } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedQueuedRun(deps);

	await publishPendingOutboxEntries(daemonContext, { repos, publisher }, publishPendingOutboxEntriesDaemonConfig);

	const claim = await claimRun({ context: namespaceRequestContext, repos, runId: seeded.runId });
	return { ...seeded, ...claim };
}

export async function seedPublishedRun(deps: SeedRunDeps & { publisher: FakePublisher }) {
	const { repos, publisher } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const seeded = await seedQueuedRun(deps);

	await publishPendingOutboxEntries(daemonContext, { repos, publisher }, publishPendingOutboxEntriesDaemonConfig);

	return seeded;
}

export async function seedStalledRun(deps: SeedRunDeps) {
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const seeded = await withFakeClock(1 as TimestampMs, () => seedQueuedRun(deps));

	await stallUndeliverableRuns(daemonContext, { repos: deps.repos }, { maxAgeMs: 60_000, limit: 100 });

	return {
		runId: seeded.runId,
		workflowSource: seeded.workflowSource,
		workflowName: seeded.workflowName,
		workflowVersionId: seeded.workflowVersionId,
	};
}
