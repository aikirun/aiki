import {
	type WorkflowRun,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	type WorkflowRunState,
} from "@aikirun/types/workflow-run";
import type { ApiClient, Logger } from "@aikirun/types/client";
import type { TaskState } from "@aikirun/types/task";
import { INTERNAL } from "@aikirun/lib/symbols";

export function initWorkflowRunHandle<Input, Output>(
	api: ApiClient,
	run: WorkflowRun<Input, Output>,
	logger: Logger
): WorkflowRunHandle<Input, Output> {
	return new WorkflowRunHandleImpl(api, run, logger);
}

export interface WorkflowRunHandle<Input, Output> {
	run: WorkflowRun<Input, Output>;

	transitionState: (state: WorkflowRunState<Output>) => Promise<void>;

	[INTERNAL]: {
		refresh: () => Promise<void>;
		getTaskState: (taskPath: string) => TaskState<unknown>;
		transitionTaskState: (taskPath: string, taskState: TaskState<unknown>) => Promise<void>;
		assertExecutionAllowed: () => Promise<void>;
	};
}

class WorkflowRunHandleImpl<Input, Output> implements WorkflowRunHandle<Input, Output> {
	public readonly [INTERNAL]: WorkflowRunHandle<Input, Output>[typeof INTERNAL];

	constructor(
		private readonly api: ApiClient,
		public _run: WorkflowRun<Input, Output>,
		private readonly logger: Logger
	) {
		this[INTERNAL] = {
			refresh: this.refresh.bind(this),
			getTaskState: this.getTaskState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
			assertExecutionAllowed: this.assertExecutionAllowed.bind(this),
		};
	}

	public get run(): Readonly<WorkflowRun<Input, Output>> {
		return this._run;
	}

	private async refresh() {
		const { run: currentRun } = await this.api.workflowRun.getByIdV1({ id: this.run.id });
		this._run = currentRun as WorkflowRun<Input, Output>;
	}

	public async transitionState(targetState: WorkflowRunState<Output>): Promise<void> {
		await this.api.workflowRun.transitionStateV1({
			id: this.run.id,
			state: targetState,
			expectedRevision: this.run.revision,
		});
		await this.refresh();
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
		this._run.revision = newRevision;
		this._run.tasksState[taskPath] = taskState;
	}

	private async assertExecutionAllowed() {
		await this.refresh();
		const status = this.run.state.status;
		if (status === "queued" || status === "running") {
			return;
		}
		throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, status);
	}
}
