import type { Workflow } from "./definition.ts";

export function initWorkflowRegistry(): WorkflowRegistry {
	return new WorkflowRegistryImpl();
}

export interface WorkflowRegistry {
	add: <Payload, Result>(workflow: Workflow<Payload, Result>) => WorkflowRegistry;
	addMany: <Payload, Result>(workflows: Workflow<Payload, Result>[]) => WorkflowRegistry;
	remove: <Payload, Result>(workflow: Workflow<Payload, Result>) => WorkflowRegistry;
	removeMany: <Payload, Result>(workflows: Workflow<Payload, Result>[]) => WorkflowRegistry;
	removeAll: () => WorkflowRegistry;

	_getByPath: (path: string) => Workflow<unknown, unknown> | undefined;
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	private workflowsByPath: Map<string, Workflow<unknown, unknown>> = new Map();

	constructor() {
		this.workflowsByPath = new Map();
	}

	public add<Payload, Result>(
		workflow: Workflow<Payload, Result>,
	): WorkflowRegistry {
		if (this.workflowsByPath.has(workflow.path)) {
			// TODO: use custom error
			throw new Error(
				`2 workflows cannot have the same path ${workflow.path}`,
			);
		}
		this.workflowsByPath.set(
			workflow.path,
			workflow as Workflow<unknown, unknown>,
		);
		return this;
	}

	public addMany<Payload, Result>(
		workflows: Workflow<Payload, Result>[],
	): WorkflowRegistry {
		for (const workflow of workflows) {
			if (this.workflowsByPath.has(workflow.path)) {
				throw new Error(
					`2 workflows cannot have the same path ${workflow.path}`,
				);
			}
			this.workflowsByPath.set(
				workflow.path,
				workflow as Workflow<unknown, unknown>,
			);
		}
		return this;
	}

	public remove<Payload, Result>(
		workflow: Workflow<Payload, Result>,
	): WorkflowRegistry {
		this.workflowsByPath.delete(workflow.path);
		return this;
	}

	public removeMany<Payload, Result>(
		workflows: Workflow<Payload, Result>[],
	): WorkflowRegistry {
		for (const workflow of workflows) {
			this.workflowsByPath.delete(workflow.path);
		}
		return this;
	}

	public removeAll(): WorkflowRegistry {
		this.workflowsByPath.clear();
		return this;
	}

	public _getByPath(path: string): Workflow<unknown, unknown> | undefined {
		return this.workflowsByPath.get(path);
	}
}
