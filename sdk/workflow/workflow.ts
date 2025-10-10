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

	v: <Input extends SerializableInput = null, Output = void>(
		versionId: string,
		params: WorkflowVersionParams<Input, Output>,
	) => WorkflowVersion<Input, Output>;

	_internal: {
		getAllVersions: () => WorkflowVersion<unknown, unknown>[];
		getVersion: (versionId: WorkflowVersionId) => WorkflowVersion<unknown, unknown> | undefined;
	};
}

class WorkflowImpl implements Workflow {
	public readonly name: WorkflowName;
	public readonly _internal: Workflow["_internal"];
	private workflowVersions = new Map<WorkflowVersionId, WorkflowVersion<unknown, unknown>>();

	constructor(params: WorkflowParams) {
		this.name = params.name as WorkflowName;
		this._internal = {
			getAllVersions: this.getAllVersions.bind(this),
			getVersion: this.getVersion.bind(this),
		};
	}

	v<Input, Output>(
		versionId: string,
		params: WorkflowVersionParams<Input, Output>,
	): WorkflowVersion<Input, Output> {
		if (this.workflowVersions.has(versionId as WorkflowVersionId)) {
			throw new Error(`Workflow "${this.name}/${versionId}" already exists`);
		}

		const workflowVersion = new WorkflowVersionImpl(this.name, versionId as WorkflowVersionId, params);
		this.workflowVersions.set(
			versionId as WorkflowVersionId,
			workflowVersion as unknown as WorkflowVersion<unknown, unknown>,
		);

		return workflowVersion;
	}

	private getAllVersions(): WorkflowVersion<unknown, unknown>[] {
		return Array.from(this.workflowVersions.values());
	}

	private getVersion(versionId: WorkflowVersionId): WorkflowVersion<unknown, unknown> | undefined {
		return this.workflowVersions.get(versionId);
	}
}
