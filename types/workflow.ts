export type WorkflowName = string & { _brand: "workflow_name" };
export type WorkflowVersionId = string & { _brand: "workflow_version_id" };

export interface WorkflowMeta {
	name: WorkflowName;
	versionId: WorkflowVersionId;
}

export interface WorkflowVersionStats {
	firstSeenAt: number;
	lastRunAt: number;
	runCount: number;
}

export interface Workflow {
	name: WorkflowName;
	versions: Record<string, WorkflowVersionStats>;
	runCount: number;
	lastRunAt: number;
}
