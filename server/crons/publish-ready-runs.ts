import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/array";
import type { Repositories, WorkflowRunOutboxRowInsert } from "server/infra/db/types";
import type { WorkflowRunPublisher, WorkflowRunReadyMessage } from "server/infra/messaging/redis-publisher";
import type { CronContext } from "server/middleware/context";

export interface PublishReadyRunsDeps {
	repos: Pick<Repositories, "workflowRunOutbox">;
	workflowRunPublisher: WorkflowRunPublisher;
}

export async function publishReadyRuns(context: CronContext, deps: PublishReadyRunsDeps, options?: { limit?: number }) {
	const { limit = 100 } = options ?? {};

	const pendingEntries = await deps.repos.workflowRunOutbox.listPending(limit);
	if (!isNonEmptyArray(pendingEntries)) {
		return;
	}

	await publishRuns(context, deps.repos, deps.workflowRunPublisher, pendingEntries);
}

export async function publishRuns(
	context: CronContext,
	repos: Pick<Repositories, "workflowRunOutbox">,
	workflowRunPublisher: WorkflowRunPublisher,
	entries: NonEmptyArray<WorkflowRunOutboxRowInsert>
): Promise<void> {
	const entryIds: string[] = [];
	const messages: WorkflowRunReadyMessage[] = [];
	for (const entry of entries) {
		entryIds.push(entry.id);
		messages.push({
			id: entry.workflowRunId,
			name: entry.workflowName,
			versionId: entry.workflowVersionId,
			shard: entry.shard ?? undefined,
		});
	}

	await workflowRunPublisher.publishReadyRuns(context, messages);
	await repos.workflowRunOutbox.markPublished(entryIds as NonEmptyArray<string>);
}
