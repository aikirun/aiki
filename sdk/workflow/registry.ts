import type { WorkflowId } from "@aikirun/types/workflow";
import type { Workflow } from "./workflow";

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
		getAll(): Workflow[];
		get: (id: WorkflowId) => Workflow | undefined;
	};
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	public readonly _internal: WorkflowRegistry["_internal"];
	private workflowsById: Map<WorkflowId, Workflow> = new Map();

	constructor() {
		this._internal = {
			getAll: this.getAll.bind(this),
			get: this.get.bind(this),
		};
	}

	public add(workflow: Workflow): WorkflowRegistry {
		if (this.workflowsById.has(workflow.id)) {
			throw new Error(`Workflow "${workflow.id}" is already registered`);
		}
		this.workflowsById.set(workflow.id, workflow);
		return this;
	}

	public addMany(workflows: Workflow[]): WorkflowRegistry {
		for (const workflow of workflows) {
			this.add(workflow);
		}
		return this;
	}

	public remove(workflow: Workflow): WorkflowRegistry {
		this.workflowsById.delete(workflow.id);
		return this;
	}

	public removeMany(workflows: Workflow[]): WorkflowRegistry {
		for (const workflow of workflows) {
			this.remove(workflow);
		}
		return this;
	}

	public removeAll(): WorkflowRegistry {
		this.workflowsById.clear();
		return this;
	}

	private getAll(): Workflow[] {
		return Array.from(this.workflowsById.values());
	}

	private get(id: WorkflowId): Workflow | undefined {
		return this.workflowsById.get(id);
	}
}
