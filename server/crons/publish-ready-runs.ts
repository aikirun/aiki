import { isNonEmptyArray } from "@aikirun/lib";
import type { WorkflowRunOutboxRepository } from "server/infra/db/repository/workflow-run-outbox";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { CronContext } from "server/middleware/context";

export interface PublishReadyRunsDeps {
	workflowRunOutboxRepo: WorkflowRunOutboxRepository;
	workflowRunPublisher: WorkflowRunPublisher;
}

export async function publishReadyRuns(context: CronContext, deps: PublishReadyRunsDeps, options?: { limit?: number }) {
	const { limit = 100 } = options ?? {};

	const pendingMessages = await deps.workflowRunOutboxRepo.listPending(limit);
	const pendingMessageIds = pendingMessages.map((entry) => entry.id);
	if (!isNonEmptyArray(pendingMessageIds)) {
		return;
	}

	await deps.workflowRunPublisher.publishReadyRuns(
		context,
		pendingMessages.map((entry) => ({
			id: entry.workflowRunId,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			shard: entry.shard ?? undefined,
		}))
	);

	await deps.workflowRunOutboxRepo.markPublished(pendingMessageIds);
}
