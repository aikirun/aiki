import type { WorkflowName, WorkflowVersionId } from "@aiki/contract/workflow";
import type { WorkflowVersion } from "@aiki/sdk/workflow";

export function initWorkflowRegistry(): WorkflowRegistry {
	return new WorkflowRegistryImpl();
}

export interface WorkflowRegistryEntry {
	workflowVersion: WorkflowVersion<unknown, unknown, unknown>;
	dependencies: unknown;
}

export interface WorkflowRegistry {
	add: <Input, Output, Dependencies>(
		workflowVersion: WorkflowVersion<Input, Output, Dependencies>,
		...args: Dependencies extends void ? [] : [Dependencies]
	) => WorkflowRegistry;
	remove: <Input, Output, Dependencies>(
		workflowVersion: WorkflowVersion<Input, Output, Dependencies>,
	) => WorkflowRegistry;
	removeAll: () => WorkflowRegistry;

	_internal: {
		getAll(): WorkflowRegistryEntry[];
		get: (
			name: WorkflowName,
			versionId: WorkflowVersionId,
		) => WorkflowRegistryEntry | undefined;
	};
}

class WorkflowRegistryImpl implements WorkflowRegistry {
	public readonly _internal: WorkflowRegistry["_internal"];
	private registry: Map<WorkflowName, Map<WorkflowVersionId, WorkflowRegistryEntry>> = new Map();

	constructor() {
		this._internal = {
			getAll: this.getAll.bind(this),
			get: this.get.bind(this),
		};
	}

	public add<Input, Output, Dependencies>(
		workflowVersion: WorkflowVersion<Input, Output, Dependencies>,
		...args: Dependencies extends void ? [] : [Dependencies]
	): WorkflowRegistry {
		const entryByVersionId = this.registry.get(workflowVersion.name);
		if (entryByVersionId && entryByVersionId.has(workflowVersion.versionId)) {
			throw new Error(`Workflow "${workflowVersion.name}/${workflowVersion.versionId}" already registered`);
		}

		const entry: WorkflowRegistryEntry = {
			workflowVersion: workflowVersion as WorkflowVersion<unknown, unknown, unknown>,
			dependencies: args[0],
		};
		if (entryByVersionId) {
			entryByVersionId.set(workflowVersion.versionId, entry);
		} else {
			this.registry.set(workflowVersion.name, new Map([[workflowVersion.versionId, entry]]));
		}

		return this;
	}

	public remove<Input, Output, Dependencies>(
		workflowVersion: WorkflowVersion<Input, Output, Dependencies>,
	): WorkflowRegistry {
		this.registry.get(workflowVersion.name)?.delete(workflowVersion.versionId);
		return this;
	}

	public removeAll(): WorkflowRegistry {
		this.registry.clear();
		return this;
	}

	private get(name: WorkflowName, versionId: WorkflowVersionId): WorkflowRegistryEntry | undefined {
		return this.registry.get(name)?.get(versionId);
	}

	private getAll(): WorkflowRegistryEntry[] {
		const entries: WorkflowRegistryEntry[] = [];
		for (const entryByVersionId of this.registry.values()) {
			for (const entry of entryByVersionId.values()) {
				entries.push(entry);
			}
		}
		return entries;
	}
}
