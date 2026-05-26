import type { ChildWorkflowRunWaitQueueRepository } from "./child-workflow-run-wait-queue";
import type { EventWaitQueueRepository } from "./event-wait-queue";
import type { ScheduleRepository } from "./schedule";
import type { SleepQueueRepository } from "./sleep-queue";
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
	sleepQueue: SleepQueueRepository;
	eventWaitQueue: EventWaitQueueRepository;
	childWorkflowRunWaitQueue: ChildWorkflowRunWaitQueueRepository;
	workflowRunOutbox: WorkflowRunOutboxRepository;
	transaction<T>(fn: (txRepos: Omit<Repositories, "transaction">) => Promise<T>): Promise<T>;
}
