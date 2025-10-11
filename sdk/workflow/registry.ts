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
		getAll(): Workflow[];
		get: (name: WorkflowName) => Workflow | undefined;
	};
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	public readonly _internal: WorkflowRegistry["_internal"];
	private workflowsByName: Map<WorkflowName, Workflow> = new Map();

	constructor() {
		this._internal = {
			getAll: this.getAll.bind(this),
			get: this.get.bind(this),
		};
	}

	public add(workflow: Workflow): WorkflowRegistry {
		if (this.workflowsByName.has(workflow.name)) {
			throw new Error(`Workflow "${workflow.name}" is already registered`);
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

	private getAll(): Workflow[] {
		return Array.from(this.workflowsByName.values());
	}

	private get(name: WorkflowName): Workflow | undefined {
		return this.workflowsByName.get(name);
	}
}
