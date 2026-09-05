import type { WorkflowSource } from "../workflow";

export interface WorkflowApi {
	listV1: (_: WorkflowListRequestV1) => Promise<WorkflowListResponseV1>;
	listVersionsV1: (_: WorkflowListVersionsRequestV1) => Promise<WorkflowListVersionsResponseV1>;
}

export interface WorkflowListRequestV1 {
	source: WorkflowSource;
	limit?: number;
	offset?: number;
	namePrefix?: string;
}

export interface WorkflowListItem {
	name: string;
	source: WorkflowSource;
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
}

export interface WorkflowVersionItem {
	versionId: string;
}

export interface WorkflowListVersionsResponseV1 {
	versions: WorkflowVersionItem[];
	total: number;
}
