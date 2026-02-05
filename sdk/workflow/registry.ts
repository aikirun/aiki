import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import type { WorkflowVersion } from "./workflow-version";

export function workflowRegistry(): WorkflowRegistry {
	return new WorkflowRegistryImpl();
}

type Workflow = WorkflowVersion<unknown, unknown, unknown>;

export interface WorkflowRegistry {
	add: (workflow: Workflow) => WorkflowRegistry;
	addMany: (workflows: Workflow[]) => WorkflowRegistry;
	remove: (workflow: Workflow) => WorkflowRegistry;
	removeMany: (workflows: Workflow[]) => WorkflowRegistry;
	removeAll: () => WorkflowRegistry;
	getAll(): Workflow[];
	get: (name: WorkflowName, versionId: WorkflowVersionId) => Workflow | undefined;
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	private workflowsByName: Map<WorkflowName, Map<WorkflowVersionId, Workflow>> = new Map();

	public add(workflow: Workflow): WorkflowRegistry {
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

	public addMany(workflows: Workflow[]): WorkflowRegistry {
		for (const workflow of workflows) {
			this.add(workflow);
		}
		return this;
	}

	public remove(workflow: Workflow): WorkflowRegistry {
		const workflowVersinos = this.workflowsByName.get(workflow.name);
		if (workflowVersinos) {
			workflowVersinos.delete(workflow.versionId);
		}
		return this;
	}

	public removeMany(workflows: Workflow[]): WorkflowRegistry {
		for (const workflow of workflows) {
			this.remove(workflow);
		}
		return this;
	}

	public removeAll(): WorkflowRegistry {
		this.workflowsByName.clear();
		return this;
	}

	public getAll(): Workflow[] {
		const workflows: Workflow[] = [];
		for (const workflowVersions of this.workflowsByName.values()) {
			for (const workflow of workflowVersions.values()) {
				workflows.push(workflow);
			}
		}
		return workflows;
	}

	public get(name: WorkflowName, versionId: WorkflowVersionId): Workflow | undefined {
		return this.workflowsByName.get(name)?.get(versionId);
	}
}
