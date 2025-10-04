import type { WorkflowName } from "@aiki/types/workflow";
import type { Workflow } from "./workflow.ts";

export function initWorkflowRegistry(): WorkflowRegistry {
	return new WorkflowRegistryImpl();
}

export interface WorkflowRegistry {
	add: (workflow: Workflow) => WorkflowRegistry;
	addMany: (workflows: Workflow[]) => WorkflowRegistry;
	remove: (workflow: Workflow) => WorkflowRegistry;
	removeMany: (workflows: Workflow[]) => WorkflowRegistry;
	removeAll: () => WorkflowRegistry;
	_internal: {
		getNames(): WorkflowName[];
		getByName: (name: WorkflowName) => Workflow | undefined;
	};
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	public readonly _internal: WorkflowRegistry["_internal"];
	private workflowsByName: Map<WorkflowName, Workflow> = new Map();

	constructor() {
		this._internal = {
			getNames: () => Array.from(this.workflowsByName.keys()),
			getByName: (name: WorkflowName) => this.workflowsByName.get(name),
		};
	}

	public add(workflow: Workflow): WorkflowRegistry {
		if (this.workflowsByName.has(workflow.name)) {
			throw new Error(`Workflow "${workflow.name}" is already registered`);
		}

		const workflowVersions = workflow._internal.getAllVersions();
		const uniqueWorkflowVersionIds = new Set(workflow._internal.getAllVersions().map(({ versionId }) => versionId));
		if (workflowVersions.length !== uniqueWorkflowVersionIds.size) {
			throw new Error(`Workflow "${workflow.name}" has duplicate versions`);
		}

		this.workflowsByName.set(workflow.name, workflow);

		return this;
	}

	public addMany(workflows: Workflow[]): WorkflowRegistry {
		for (const workflow of workflows) {
			this.add(workflow);
		}
		return this;
	}

	public remove(workflow: Workflow): WorkflowRegistry {
		this.workflowsByName.delete(workflow.name);
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
}
