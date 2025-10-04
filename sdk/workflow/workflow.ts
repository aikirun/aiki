import type { BrandedString } from "@lib/string/mod.ts";
import {
	WorkflowVersionImpl,
	type WorkflowVersion,
	type WorkflowVersionId,
	type WorkflowVersionParams,
} from "./version/workflow-version.ts";

export function workflow(params: WorkflowParams): Workflow {
	return new WorkflowImpl(params);
}

export interface WorkflowParams {
	name: string;
}

export type WorkflowName = BrandedString<"workflow_name">;

export interface Workflow {
	name: WorkflowName;
	v: <Payload, Result>(
		versionId: string,
		params: WorkflowVersionParams<Payload, Result>,
	) => WorkflowVersion<Payload, Result>;
	_internal: {
		getAllVersions: () => Array<WorkflowVersion<unknown, unknown>>;
		getVersion: (versionId: WorkflowVersionId) => WorkflowVersion<unknown, unknown> | undefined;
	};
}

class WorkflowImpl implements Workflow {
	public readonly name: WorkflowName;
	public readonly _internal: Workflow["_internal"];
	private workflowVersionMap = new Map<WorkflowVersionId, WorkflowVersion<unknown, unknown>>();

	constructor(params: WorkflowParams) {
		this.name = params.name as WorkflowName;
		this._internal = {
			getAllVersions: () => Array.from(this.workflowVersionMap.values()),
			getVersion: (versionId: WorkflowVersionId) => this.workflowVersionMap.get(versionId),
		};
	}

	v<Payload, Result>(
		versionId: string,
		params: WorkflowVersionParams<Payload, Result>,
	): WorkflowVersion<Payload, Result> {
		const workflowVersion = new WorkflowVersionImpl(this.name, versionId as WorkflowVersionId, params);
		this.workflowVersionMap.set(
			versionId as WorkflowVersionId,
			workflowVersion as unknown as WorkflowVersion<unknown, unknown>,
		);
		return workflowVersion;
	}
}

