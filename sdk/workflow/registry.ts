import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowVersion } from "./workflow-version";

export function initWorkflowRegistry(): WorkflowRegistry {
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
	get: (id: WorkflowId, versionId: WorkflowVersionId) => Workflow | undefined;
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	private workflowsById: Map<WorkflowId, Map<WorkflowVersionId, Workflow>> = new Map();

	public add(workflow: Workflow): WorkflowRegistry {
		const workflows = this.workflowsById.get(workflow.id);
		if (!workflows) {
			this.workflowsById.set(workflow.id, new Map([[workflow.versionId, workflow]]));
			return this;
		}
		if (workflows.has(workflow.versionId)) {
			throw new Error(`Workflow "${workflow.id}/${workflow.versionId}" is already registered`);
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
		const workflowVersinos = this.workflowsById.get(workflow.id);
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
		this.workflowsById.clear();
		return this;
	}

	public getAll(): Workflow[] {
		const workflows: Workflow[] = [];
		for (const workflowVersions of this.workflowsById.values()) {
			for (const workflow of workflowVersions.values()) {
				workflows.push(workflow);
			}
		}
		return workflows;
	}

	public get(id: WorkflowId, versionId: WorkflowVersionId): Workflow | undefined {
		return this.workflowsById.get(id)?.get(versionId);
	}
}
