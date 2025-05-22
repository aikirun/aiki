import type { Workflow } from "./definition.ts";

export function initWorkflowRegistry(): WorkflowRegistry {
	return new WorkflowRegistryImpl();
}

export interface WorkflowRegistry {
	register: <Payload, Result>(
		workflow: Workflow<Payload, Result>,
	) => WorkflowRegistry;
	deregister: <Payload, Result>(
		workflow: Workflow<Payload, Result>,
	) => WorkflowRegistry;
	deregisterAll: () => WorkflowRegistry;

	_getByPath: (path: string) => Workflow<unknown, unknown> | undefined;
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	private workflowsByPath: Map<string, Workflow<unknown, unknown>> = new Map();

	constructor() {
		this.workflowsByPath = new Map();
	}

	// TODO: params is unused
	public register<Payload, Result>(
		workflow: Workflow<Payload, Result>,
	): WorkflowRegistry {
		if (this.workflowsByPath.has(workflow.path)) {
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

	public deregister<Payload, Result>(
		workflow: Workflow<Payload, Result>,
	): WorkflowRegistry {
		this.workflowsByPath.delete(workflow.path);
		return this;
	}

	public deregisterAll(): WorkflowRegistry {
		this.workflowsByPath.clear();
		return this;
	}

	public _getByPath(path: string): Workflow<unknown, unknown> | undefined {
		return this.workflowsByPath.get(path);
	}
}
