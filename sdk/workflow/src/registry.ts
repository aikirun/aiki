import type { WorkflowName, WorkflowSource, WorkflowVersionId } from "@aikirun/types/workflow";

import type { AnyWorkflowVersion } from "./workflow-version";

export interface WorkflowRegistry {
	add: (source: WorkflowSource, workflow: AnyWorkflowVersion) => WorkflowRegistry;
	addMany: (source: WorkflowSource, workflows: AnyWorkflowVersion[]) => WorkflowRegistry;
	remove: (source: WorkflowSource, workflow: AnyWorkflowVersion) => WorkflowRegistry;
	removeMany: (source: WorkflowSource, workflows: AnyWorkflowVersion[]) => WorkflowRegistry;
	removeAll: () => WorkflowRegistry;
	getAll(): { source: WorkflowSource; workflow: AnyWorkflowVersion }[];
	get: (source: WorkflowSource, name: WorkflowName, versionId: WorkflowVersionId) => AnyWorkflowVersion | undefined;
}

export function workflowRegistry(): WorkflowRegistry {
	const store = new Map<WorkflowSource, Map<WorkflowName, Map<WorkflowVersionId, AnyWorkflowVersion>>>();

	const registry: WorkflowRegistry = {
		add(source, workflow) {
			const workflowsByName = store.get(source);
			if (!workflowsByName) {
				const workflowVersions = new Map([[workflow.versionId, workflow]]);
				store.set(source, new Map([[workflow.name, workflowVersions]]));
				return registry;
			}

			const workflowVersions = workflowsByName.get(workflow.name);
			if (!workflowVersions) {
				workflowsByName.set(workflow.name, new Map([[workflow.versionId, workflow]]));
				return registry;
			}

			if (workflowVersions.has(workflow.versionId)) {
				throw new Error(
					`Workflow "${workflow.name}:${workflow.versionId}" with source "${source}" is already registered`
				);
			}
			workflowVersions.set(workflow.versionId, workflow);
			return registry;
		},

		addMany(source, workflows) {
			for (const workflow of workflows) {
				registry.add(source, workflow);
			}
			return registry;
		},

		remove(source, workflow) {
			const workflowVersions = store.get(source)?.get(workflow.name);
			if (workflowVersions) {
				workflowVersions.delete(workflow.versionId);
			}
			return registry;
		},

		removeMany(source, workflows) {
			for (const workflow of workflows) {
				registry.remove(source, workflow);
			}
			return registry;
		},

		removeAll() {
			store.clear();
			return registry;
		},

		getAll() {
			const workflows: { source: WorkflowSource; workflow: AnyWorkflowVersion }[] = [];
			for (const [source, workflowsByName] of store.entries()) {
				for (const workflowVersions of workflowsByName.values()) {
					for (const workflow of workflowVersions.values()) {
						workflows.push({ source, workflow });
					}
				}
			}

			return workflows;
		},

		get(source, name, versionId) {
			return store.get(source)?.get(name)?.get(versionId);
		},
	};

	return registry;
}
