import type { ChildWorkflowRunWaitRepository } from "./child-workflow-run-wait";
import type { EventWaitRepository } from "./event-wait";
import type { ScheduleRepository } from "./schedule";
import type { SleepRepository } from "./sleep";
import type { StateTransitionRepository } from "./state-transition";
import type { TaskRepository } from "./task";
import type { WorkflowRepository } from "./workflow";
import type { WorkflowRunRepository } from "./workflow-run";
import type { WorkflowRunOutboxRepository } from "./workflow-run-outbox";

export interface Repositories {
	workflowRun: WorkflowRunRepository;
	task: TaskRepository;
	stateTransition: StateTransitionRepository;
	schedule: ScheduleRepository;
	workflow: WorkflowRepository;
	sleep: SleepRepository;
	eventWait: EventWaitRepository;
	childWorkflowRunWait: ChildWorkflowRunWaitRepository;
	workflowRunOutbox: WorkflowRunOutboxRepository;
	transaction<T>(fn: (txRepos: TxRepositories) => Promise<T>): Promise<T>;
}

declare const inTransaction: unique symbol;

export type TxRepositories = Omit<Repositories, "transaction"> & {
	readonly [inTransaction]: true;
	/**
	 * Runs `effect` after this transaction commits; a rollback drops it without
	 * running.
	 */
	onCommit(effect: () => void): void;
};
