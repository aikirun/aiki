import type { WorkflowRunStatus } from "./workflow-run";

export interface WorkflowApi {
	getStatsV1: (_: WorkflowGetStatsRequestV1) => Promise<WorkflowGetStatsResponseV1>;
	listV1: (_: WorkflowListRequestV1) => Promise<WorkflowListResponseV1>;
	listVersionsV1: (_: WorkflowListVersionsRequestV1) => Promise<WorkflowListVersionsResponseV1>;
}

export interface WorkflowGetStatsRequestV1 {
	name?: string;
	versionId?: string;
}

export interface WorkflowGetStatsResponseV1 {
	stats: WorkflowStats;
}

export interface WorkflowStats {
	totalRuns: number;
	runsByStatus: Record<WorkflowRunStatus, number>;
}

export interface WorkflowListRequestV1 {
	limit?: number;
	offset?: number;
	sort?: {
		field: "name" | "runCount" | "lastRunAt";
		order: "asc" | "desc";
	};
}

export interface WorkflowListItem {
	name: string;
	runCount: number;
	lastRunAt: number | null;
}

export interface WorkflowListResponseV1 {
	workflows: WorkflowListItem[];
	total: number;
}

export interface WorkflowListVersionsRequestV1 {
	name: string;
	limit?: number;
	offset?: number;
	sort?: {
		field: "firstSeenAt" | "runCount";
		order: "asc" | "desc";
	};
}

export interface WorkflowVersionItem {
	versionId: string;
	firstSeenAt: number;
	lastRunAt: number | null;
	runCount: number;
}

export interface WorkflowListVersionsResponseV1 {
	versions: WorkflowVersionItem[];
	total: number;
}
