import type { WorkflowSource } from "./workflow";
import type { WorkflowRunStatus } from "./workflow-run";

export interface WorkflowApi {
	listV1: (_: WorkflowListRequestV1) => Promise<WorkflowListResponseV1>;
	listVersionsV1: (_: WorkflowListVersionsRequestV1) => Promise<WorkflowListVersionsResponseV1>;
	getStatsV1: (_: WorkflowGetStatsRequestV1) => Promise<WorkflowGetStatsResponseV1>;
}

export interface WorkflowListRequestV1 {
	source: WorkflowSource;
	limit?: number;
	offset?: number;
	namePrefix?: string;
	sort?: {
		field: "name" | "runCount" | "lastRunAt";
		order: "asc" | "desc";
	};
}

export interface WorkflowListItem {
	name: string;
	source: WorkflowSource;
	runCount: number;
	lastRunAt: number | null;
}

export interface WorkflowListResponseV1 {
	workflows: WorkflowListItem[];
	total: number;
}

export interface WorkflowListVersionsRequestV1 {
	name: string;
	source: WorkflowSource;
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

export type WorkflowGetStatsRequestV1 = { name: string; source: WorkflowSource; versionId?: string } | undefined;

export interface WorkflowGetStatsResponseV1 {
	stats: WorkflowStats;
}

export interface WorkflowStats {
	runsByStatus: Record<WorkflowRunStatus, number>;
}
