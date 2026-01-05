export type WorkflowName = string & { _brand: "workflow_name" };
export type WorkflowVersionId = string & { _brand: "workflow_version_id" };

export interface WorkflowMeta {
	name: WorkflowName;
	versionId: WorkflowVersionId;
}
