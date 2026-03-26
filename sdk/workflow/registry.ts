import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import type { UnknownWorkflowVersion } from "./workflow-version";

export function workflowRegistry(): WorkflowRegistry {
	return new WorkflowRegistryImpl();
}

export interface WorkflowRegistry {
	add: (workflow: UnknownWorkflowVersion) => WorkflowRegistry;
	addMany: (workflows: UnknownWorkflowVersion[]) => WorkflowRegistry;
	remove: (workflow: UnknownWorkflowVersion) => WorkflowRegistry;
	removeMany: (workflows: UnknownWorkflowVersion[]) => WorkflowRegistry;
	removeAll: () => WorkflowRegistry;
	getAll(): UnknownWorkflowVersion[];
	get: (name: WorkflowName, versionId: WorkflowVersionId) => UnknownWorkflowVersion | undefined;
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	private workflowsByName: Map<WorkflowName, Map<WorkflowVersionId, UnknownWorkflowVersion>> = new Map();

	public add(workflow: UnknownWorkflowVersion): WorkflowRegistry {
		const workflows = this.workflowsByName.get(workflow.name);
		if (!workflows) {
			this.workflowsByName.set(workflow.name, new Map([[workflow.versionId, workflow]]));
			return this;
		}
		if (workflows.has(workflow.versionId)) {
			throw new Error(`Workflow "${workflow.name}:${workflow.versionId}" is already registered`);
		}
		workflows.set(workflow.versionId, workflow);
		return this;
	}

	public addMany(workflows: UnknownWorkflowVersion[]): WorkflowRegistry {
		for (const workflow of workflows) {
			this.add(workflow);
		}
		return this;
	}

	public remove(workflow: UnknownWorkflowVersion): WorkflowRegistry {
		const workflowVersinos = this.workflowsByName.get(workflow.name);
		if (workflowVersinos) {
			workflowVersinos.delete(workflow.versionId);
		}
		return this;
	}

	public removeMany(workflows: UnknownWorkflowVersion[]): WorkflowRegistry {
		for (const workflow of workflows) {
			this.remove(workflow);
		}
		return this;
	}

	public removeAll(): WorkflowRegistry {
		this.workflowsByName.clear();
		return this;
	}

	public getAll(): UnknownWorkflowVersion[] {
		const workflows: UnknownWorkflowVersion[] = [];
		for (const workflowVersions of this.workflowsByName.values()) {
			for (const workflow of workflowVersions.values()) {
				workflows.push(workflow);
			}
		}
		return workflows;
	}

	public get(name: WorkflowName, versionId: WorkflowVersionId): UnknownWorkflowVersion | undefined {
		return this.workflowsByName.get(name)?.get(versionId);
	}
}
