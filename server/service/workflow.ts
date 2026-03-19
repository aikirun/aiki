import { isNonEmptyArray } from "@aikirun/lib";
import type {
	WorkflowGetStatsRequestV1,
	WorkflowListRequestV1,
	WorkflowListVersionsRequestV1,
} from "@aikirun/types/workflow-api";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import type { Repositories } from "server/infra/db/types";
import type { NamespaceRequestContext } from "server/middleware/context";
import { decodeTime } from "ulidx";

export interface WorkflowServiceDeps {
	repos: Pick<Repositories, "workflow" | "workflowRun">;
}

export function createWorkflowService(deps: WorkflowServiceDeps) {
	const { repos } = deps;

	return {
		async listWorkflowsWithStats(context: NamespaceRequestContext, request: WorkflowListRequestV1) {
			const { items, total } = await repos.workflow.listWithStats(context.namespaceId, request);
			return {
				workflows: items.map((item) => ({
					name: item.name,
					source: request.source,
					runCount: item.runCount,
					lastRunAt: item.lastRunId ? decodeTime(item.lastRunId) : null,
				})),
				total,
			};
		},

		async listWorkflowVersionsWithStats(context: NamespaceRequestContext, request: WorkflowListVersionsRequestV1) {
			const { items, total } = await repos.workflow.listVersionsWithStats(context.namespaceId, request);
			return {
				versions: items.map((item) => ({
					versionId: item.versionId,
					firstSeenAt: item.firstSeenAt.getTime(),
					lastRunAt: item.lastRunId ? decodeTime(item.lastRunId) : null,
					runCount: item.runCount,
				})),
				total,
			};
		},

		async getWorkflowStats(context: NamespaceRequestContext, request: WorkflowGetStatsRequestV1) {
			const namespaceId = context.namespaceId;

			const workflowIds = request
				? (await repos.workflow.listByNameAndVersion(namespaceId, request)).map((workflow) => workflow.id)
				: undefined;

			const statusCounts = request
				? isNonEmptyArray(workflowIds)
					? await repos.workflowRun.countByStatus({ workflowIds })
					: []
				: await repos.workflowRun.countByStatus({ namespaceId });

			const workflowRunsByStatus: Record<WorkflowRunStatus, number> = {
				scheduled: 0,
				queued: 0,
				running: 0,
				paused: 0,
				sleeping: 0,
				awaiting_event: 0,
				awaiting_retry: 0,
				awaiting_child_workflow: 0,
				cancelled: 0,
				completed: 0,
				failed: 0,
			};
			for (const { status, count } of statusCounts) {
				workflowRunsByStatus[status] = count;
			}

			return {
				stats: {
					runsByStatus: workflowRunsByStatus,
				},
			};
		},
	};
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
