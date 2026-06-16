import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import type { AnyWorkflowVersion } from "./workflow-version";

export interface WorkflowRegistry {
	add: (workflow: AnyWorkflowVersion) => WorkflowRegistry;
	addMany: (workflows: AnyWorkflowVersion[]) => WorkflowRegistry;
	remove: (workflow: AnyWorkflowVersion) => WorkflowRegistry;
	removeMany: (workflows: AnyWorkflowVersion[]) => WorkflowRegistry;
	removeAll: () => WorkflowRegistry;
	getAll(): AnyWorkflowVersion[];
	get: (name: WorkflowName, versionId: WorkflowVersionId) => AnyWorkflowVersion | undefined;
}

export function workflowRegistry(): WorkflowRegistry {
	const workflowsByName = new Map<WorkflowName, Map<WorkflowVersionId, AnyWorkflowVersion>>();

	const registry: WorkflowRegistry = {
		add(workflow) {
			const workflowVersions = workflowsByName.get(workflow.name);
			if (!workflowVersions) {
				workflowsByName.set(workflow.name, new Map([[workflow.versionId, workflow]]));
				return registry;
			}
			if (workflowVersions.has(workflow.versionId)) {
				throw new Error(`Workflow "${workflow.name}:${workflow.versionId}" is already registered`);
			}
			workflowVersions.set(workflow.versionId, workflow);
			return registry;
		},

		addMany(workflows) {
			for (const workflow of workflows) {
				registry.add(workflow);
			}
			return registry;
		},

		remove(workflow) {
			const workflowVersions = workflowsByName.get(workflow.name);
			if (workflowVersions) {
				workflowVersions.delete(workflow.versionId);
			}
			return registry;
		},

		removeMany(workflows) {
			for (const workflow of workflows) {
				registry.remove(workflow);
			}
			return registry;
		},

		removeAll() {
			workflowsByName.clear();
			return registry;
		},

		getAll() {
			const workflows: AnyWorkflowVersion[] = [];
			for (const workflowVersions of workflowsByName.values()) {
				for (const workflow of workflowVersions.values()) {
					workflows.push(workflow);
				}
			}
			return workflows;
		},

		get(name, versionId) {
			return workflowsByName.get(name)?.get(versionId);
		},
	};

	return registry;
}
