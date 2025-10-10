import type { WorkflowName, WorkflowVersionId } from "@aiki/contract/workflow";
import type { ValidPayload } from "@aiki/contract/common";
import { type WorkflowVersion, WorkflowVersionImpl, type WorkflowVersionParams } from "./version/workflow-version.ts";

export function workflow(params: WorkflowParams): Workflow {
	return new WorkflowImpl(params);
}

export interface WorkflowParams {
	name: string;
}

export interface Workflow {
	name: WorkflowName;
	v: <Payload extends ValidPayload = null, Result = void, Dependencies = void>(
		versionId: string,
		params: WorkflowVersionParams<Payload, Result, Dependencies>,
	) => WorkflowVersion<Payload, Result, Dependencies>;
}

class WorkflowImpl implements Workflow {
	public readonly name: WorkflowName;

	constructor(params: WorkflowParams) {
		this.name = params.name as WorkflowName;
	}

	v<Payload, Result, Dependencies>(
		versionId: string,
		params: WorkflowVersionParams<Payload, Result, Dependencies>,
	): WorkflowVersion<Payload, Result, Dependencies> {
		const workflowVersion = new WorkflowVersionImpl(this.name, versionId as WorkflowVersionId, params);
		return workflowVersion;
	}
}
