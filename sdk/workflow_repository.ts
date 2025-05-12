import type { Workflow } from "./workflow.ts";

export interface WorkflowRepository {
    register: <Payload, Result>(workflow: Workflow<Payload, Result>) => WorkflowRepository;
    deregister: <Payload, Result>(workflow: Workflow<Payload, Result>) => WorkflowRepository;
    deregisterAll: () => WorkflowRepository;

    _getByPath: (path: string) => Workflow<unknown, unknown> | undefined;
}

export class WorkflowRepositoryImpl implements WorkflowRepository {
    private workflowsByPath: Map<string, Workflow<unknown, unknown>> = new Map();

    constructor() {
        this.workflowsByPath = new Map();
    }

    // TODO: params is unused
    public register<Payload, Result>(workflow: Workflow<Payload, Result>): WorkflowRepository {
        if (this.workflowsByPath.has(workflow.path)) {
            throw new Error(`2 workflows cannot have the same path ${workflow.path}`);
        }
        this.workflowsByPath.set(workflow.path, workflow as Workflow<unknown, unknown>);
        return this;
    }

    public deregister<Payload, Result>(workflow: Workflow<Payload, Result>): WorkflowRepository {
        this.workflowsByPath.delete(workflow.path);
        return this;
    }

    public deregisterAll(): WorkflowRepository {
        this.workflowsByPath.clear();
        return this;
    }

    public _getByPath(path: string): Workflow<unknown, unknown> | undefined {
        return this.workflowsByPath.get(path);
    }
}