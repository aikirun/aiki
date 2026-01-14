import type { WorkflowName } from "@aikirun/types/workflow";
import type { WorkflowListItem, WorkflowVersionItem } from "@aikirun/types/workflow-api";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import { NotFoundError } from "server/errors";

import { baseImplementer } from "./base";
import { getWorkflowRuns, getWorkflows } from "./workflow-run";

const os = baseImplementer.workflow;

const listV1 = os.listV1.handler(({ input: request }) => {
	const { limit = 50, offset = 0, sort } = request;

	const workflows = getWorkflows();
	const workflowList: WorkflowListItem[] = [];

	for (const workflow of workflows.values()) {
		workflowList.push({
			name: workflow.name,
			runCount: workflow.runCount,
			lastRunAt: workflow.lastRunAt,
		});
	}

	const sortField = sort?.field ?? "name";
	const sortOrder = sort?.order ?? "asc";

	workflowList.sort((a, b) => {
		let comparison = 0;
		switch (sortField) {
			case "name":
				comparison = a.name.localeCompare(b.name);
				break;
			case "runCount":
				comparison = a.runCount - b.runCount;
				break;
			case "lastRunAt":
				comparison = (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0);
				break;
		}
		return sortOrder === "asc" ? comparison : -comparison;
	});

	return {
		workflows: workflowList.slice(offset, offset + limit),
		total: workflowList.length,
	};
});

const listVersionsV1 = os.listVersionsV1.handler(({ input: request }) => {
	const { name, limit = 50, offset = 0, sort } = request;

	const workflows = getWorkflows();
	const workflow = workflows.get(name as WorkflowName);

	if (!workflow) {
		throw new NotFoundError(`Workflow not found: ${name}`);
	}

	const workflowVersionList: WorkflowVersionItem[] = [];

	for (const [versionId, version] of Object.entries(workflow.versions)) {
		workflowVersionList.push({
			versionId,
			firstSeenAt: version.firstSeenAt,
			lastRunAt: version.lastRunAt,
			runCount: version.runCount,
		});
	}

	const sortField = sort?.field ?? "firstSeenAt";
	const sortOrder = sort?.order ?? "desc";

	workflowVersionList.sort((a, b) => {
		let comparison = 0;
		switch (sortField) {
			case "firstSeenAt":
				comparison = a.firstSeenAt - b.firstSeenAt;
				break;
			case "runCount":
				comparison = a.runCount - b.runCount;
				break;
		}
		return sortOrder === "asc" ? comparison : -comparison;
	});

	return {
		versions: workflowVersionList.slice(offset, offset + limit),
		total: workflowVersionList.length,
	};
});

const getStatsV1 = os.getStatsV1.handler(({ input: request }) => {
	const { name, versionId } = request;

	const byStatus: Record<WorkflowRunStatus, number> = {
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

	let totalRuns = 0;

	for (const run of getWorkflowRuns().values()) {
		if (name && run.name !== name) {
			continue;
		}
		if (versionId && run.versionId !== versionId) {
			continue;
		}

		totalRuns++;
		byStatus[run.state.status]++;
	}

	return {
		stats: {
			totalRuns,
			runsByStatus: byStatus,
		},
	};
});

export const workflowRouter = os.router({
	getStatsV1,
	listV1,
	listVersionsV1,
});
