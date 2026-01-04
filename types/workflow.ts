export type WorkflowId = string & { _brand: "workflow_id" };
export type WorkflowVersionId = `${number}.${number}.${number}` & { _brand: "workflow_version_id" };

export interface WorkflowMeta {
	id: WorkflowId;
	versionId: WorkflowVersionId;
}
