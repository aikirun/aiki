import type { ScheduleListRequestV1 } from "@aikirun/types/api/schedule";
import type {
	WorkflowGetStatsRequestV1,
	WorkflowListRequestV1,
	WorkflowListVersionsRequestV1,
} from "@aikirun/types/api/workflow";
import type { WorkflowRunListRequestV1, WorkflowRunListTransitionsRequestV1 } from "@aikirun/types/api/workflow-run";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { namespaceAuthedClient, organizationAuthedClient } from "./client";

export function useWorkflows(params: WorkflowListRequestV1 = { source: "user" }) {
	return useQuery({
		queryKey: ["workflows", params],
		queryFn: () => namespaceAuthedClient.workflow.listV1(params),
		placeholderData: keepPreviousData,
	});
}

export function useWorkflowVersions(
	name: string,
	params: Omit<WorkflowListVersionsRequestV1, "name"> = { source: "user" }
) {
	return useQuery({
		queryKey: ["workflow-versions", name, params],
		queryFn: () => namespaceAuthedClient.workflow.listVersionsV1({ name, ...params }),
		enabled: !!name,
	});
}

export function useWorkflowStats(params: WorkflowGetStatsRequestV1 = undefined) {
	return useQuery({
		queryKey: ["workflow-stats", params],
		queryFn: () => namespaceAuthedClient.workflow.getStatsV1(params),
	});
}

export function useWorkflowRuns(params: WorkflowRunListRequestV1 = {}) {
	return useQuery({
		queryKey: ["workflow-runs", params],
		queryFn: () => namespaceAuthedClient.workflowRun.listV1(params),
		placeholderData: keepPreviousData,
	});
}

export function useWorkflowRun(
	id: string,
	options?: {
		refetchInterval?:
			| number
			| false
			| ((query: {
					state: { data?: Awaited<ReturnType<typeof namespaceAuthedClient.workflowRun.getByIdV1>> };
			  }) => number | false);
	}
) {
	return useQuery({
		queryKey: ["workflow-run", id],
		queryFn: () => namespaceAuthedClient.workflowRun.getByIdV1({ id }),
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
		queryFn: () => namespaceAuthedClient.workflowRun.listTransitionsV1({ id, ...params }),
		enabled: !!id,
		refetchInterval: options?.refetchInterval,
	});
}

export function useSchedules(params: ScheduleListRequestV1 = {}) {
	return useQuery({
		queryKey: ["schedules", params],
		queryFn: () => namespaceAuthedClient.schedule.listV1(params),
		placeholderData: keepPreviousData,
	});
}

export function useApiKeys(namespaceId: string) {
	return useQuery({
		queryKey: ["api-keys", namespaceId],
		queryFn: () => organizationAuthedClient.apiKey.listV1({ namespaceId }),
	});
}
