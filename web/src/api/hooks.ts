import type { ScheduleListRequestV1 } from "@aikirun/types/schedule-api";
import type {
	WorkflowGetStatsRequestV1,
	WorkflowListRequestV1,
	WorkflowListVersionsRequestV1,
} from "@aikirun/types/workflow-api";
import type { WorkflowRunListRequestV1, WorkflowRunListTransitionsRequestV1 } from "@aikirun/types/workflow-run-api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { client } from "./client";

export function useWorkflows(params: WorkflowListRequestV1 = {}) {
	return useQuery({
		queryKey: ["workflows", params],
		queryFn: () => client.workflow.listV1(params),
		placeholderData: keepPreviousData,
	});
}

export function useWorkflowVersions(name: string, params: Omit<WorkflowListVersionsRequestV1, "name"> = {}) {
	return useQuery({
		queryKey: ["workflow-versions", name, params],
		queryFn: () => client.workflow.listVersionsV1({ name, ...params }),
		enabled: !!name,
	});
}

export function useWorkflowStats(params: WorkflowGetStatsRequestV1 = {}) {
	return useQuery({
		queryKey: ["workflow-stats", params],
		queryFn: () => client.workflow.getStatsV1(params),
	});
}

export function useWorkflowRuns(params: WorkflowRunListRequestV1 = {}) {
	return useQuery({
		queryKey: ["workflow-runs", params],
		queryFn: () => client.workflowRun.listV1(params),
		placeholderData: keepPreviousData,
	});
}

export function useWorkflowRun(
	id: string,
	options?: {
		refetchInterval?:
			| number
			| false
			| ((query: { state: { data?: Awaited<ReturnType<typeof client.workflowRun.getByIdV1>> } }) => number | false);
	}
) {
	return useQuery({
		queryKey: ["workflow-run", id],
		queryFn: () => client.workflowRun.getByIdV1({ id }),
		enabled: !!id,
		refetchInterval: options?.refetchInterval,
	});
}

export function useWorkflowRunTransitions(
	id: string,
	params: Omit<WorkflowRunListTransitionsRequestV1, "id"> = {},
	options?: { refetchInterval?: number | false }
) {
	return useQuery({
		queryKey: ["workflow-run-transitions", id, params],
		queryFn: () => client.workflowRun.listTransitionsV1({ id, ...params }),
		enabled: !!id,
		refetchInterval: options?.refetchInterval,
	});
}

export function useSchedules(params: ScheduleListRequestV1 = {}) {
	return useQuery({
		queryKey: ["schedules", params],
		queryFn: () => client.schedule.listV1(params),
		placeholderData: keepPreviousData,
	});
}
