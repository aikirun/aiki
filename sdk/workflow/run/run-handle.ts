import type { WorkflowRun, WorkflowRunState } from "@aiki/types/workflow-run";
import type { ApiClient, Logger } from "@aiki/types/client";
import type { TaskState } from "@aiki/types/task";

export function initWorkflowRunHandle<Input, Output>(
	api: ApiClient,
	run: WorkflowRun<Input, Output>,
	logger: Logger,
): WorkflowRunHandle<Input, Output> {
	return new WorkflowRunHandleImpl(api, run, logger);
}

export interface WorkflowRunHandle<Input, Output> {
	run: WorkflowRun<Input, Output>;

	transitionState: (state: WorkflowRunState<Output>) => Promise<void>;

	_internal: {
		refresh: () => Promise<void>;
		getTaskState: (taskPath: string) => TaskState<unknown>;
		transitionTaskState: (
			taskPath: string,
			taskState: TaskState<unknown>,
		) => Promise<void>;
	};
}

class WorkflowRunHandleImpl<Input, Output> implements WorkflowRunHandle<Input, Output> {
	public readonly _internal: WorkflowRunHandle<Input, Output>["_internal"];

	constructor(
		private readonly api: ApiClient,
		public readonly run: WorkflowRun<Input, Output>,
		private readonly logger: Logger
	) {
		this._internal = {
			refresh: this.refresh.bind(this),
			getTaskState: this.getTaskState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
		};
	}

	private async refresh() {
		const { run: currentRun } = await this.api.workflowRun.getByIdV1({ id: this.run.id });
		this.run.revision = currentRun.revision;
		this.run.state = currentRun.state as WorkflowRunState<Output>;
		this.run.tasksState = currentRun.tasksState;
		this.run.subWorkflowsRunState = currentRun.subWorkflowsRunState;
	}

	public async transitionState(targetState: WorkflowRunState<Output>): Promise<void> {
		const { newRevision } = await this.api.workflowRun.transitionStateV1({
			id: this.run.id,
			state: targetState,
			expectedRevision: this.run.revision,
		});
		this.run.revision = newRevision;
		this.run.state = targetState;
	}

	private getTaskState(taskPath: string): TaskState<unknown> {
		return this.run.tasksState[taskPath] ?? { status: "none" };
	}

	private async transitionTaskState(taskPath: string, taskState: TaskState<unknown>): Promise<void> {
		const { newRevision } = await this.api.workflowRun.transitionTaskStateV1({
			id: this.run.id,
			taskPath,
			taskState,
			expectedRevision: this.run.revision,
		});
		this.run.revision = newRevision;
		this.run.tasksState[taskPath] = taskState;
	}
}
