import type { WorkflowName, WorkflowVersionId } from "@aiki/contract/workflow";
import type { SerializableInput } from "@aiki/contract/common";
import { type WorkflowVersion, WorkflowVersionImpl, type WorkflowVersionParams } from "./version/workflow-version.ts";

export function workflow(params: WorkflowParams): Workflow {
	return new WorkflowImpl(params);
}

export interface WorkflowParams {
	name: string;
}

export interface Workflow {
	name: WorkflowName;
	v: <Input extends SerializableInput = null, Output = void, Dependencies = void>(
		versionId: string,
		params: WorkflowVersionParams<Input, Output, Dependencies>,
	) => WorkflowVersion<Input, Output, Dependencies>;
}

class WorkflowImpl implements Workflow {
	public readonly name: WorkflowName;

	constructor(params: WorkflowParams) {
		this.name = params.name as WorkflowName;
	}

	v<Input, Output, Dependencies>(
		versionId: string,
		params: WorkflowVersionParams<Input, Output, Dependencies>,
	): WorkflowVersion<Input, Output, Dependencies> {
		const workflowVersion = new WorkflowVersionImpl(this.name, versionId as WorkflowVersionId, params);
		return workflowVersion;
	}
}
