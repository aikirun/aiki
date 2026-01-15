import type { Schedule, ScheduleId } from "@aikirun/types/schedule";
import type { TaskId, TaskInfo, TaskPath } from "@aikirun/types/task";
import type { Workflow, WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId, WorkflowRunTransition } from "@aikirun/types/workflow-run";

export const workflowRunsById = new Map<WorkflowRunId, WorkflowRun>();
export const workflowRunsByReferenceId = new Map<WorkflowName, Map<WorkflowVersionId, Map<string, WorkflowRunId>>>();
export const workflowRunTransitionsById = new Map<WorkflowRunId, WorkflowRunTransition[]>();
export const workflowsByName = new Map<WorkflowName, Workflow>();
export const schedulesById = new Map<ScheduleId, { schedule: Schedule; definitionHash: string }>();
export const schedulesByKey = new Map<string, ScheduleId>();

export function findTaskById(run: WorkflowRun, taskId: TaskId): (TaskInfo & { path: TaskPath }) | undefined {
	for (const [path, info] of Object.entries(run.tasks)) {
		if (info.id === taskId) {
			return {
				...info,
				path: path as TaskPath,
			};
		}
	}
	return undefined;
}
