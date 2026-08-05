import { createPgHandle, type PgClient, type PgDb } from "./provider";
import { createChildWorkflowRunWaitRepository } from "./repository/child-workflow-run-wait";
import { createEventWaitRepository } from "./repository/event-wait";
import { createScheduleRepository } from "./repository/schedule";
import { createSleepRepository } from "./repository/sleep";
import { createStateTransitionRepository } from "./repository/state-transition";
import { createTaskRepository } from "./repository/task";
import { createWorkflowRepository } from "./repository/workflow";
import { createWorkflowRunRepository } from "./repository/workflow-run";
import { createWorkflowRunOutboxRepository } from "./repository/workflow-run-outbox";
import type { Repositories } from "../types";

const createRepos = (db: PgDb): Omit<Repositories, "transaction"> => ({
	workflowRun: createWorkflowRunRepository(db),
	task: createTaskRepository(db),
	stateTransition: createStateTransitionRepository(db),
	schedule: createScheduleRepository(db),
	workflow: createWorkflowRepository(db),
	sleep: createSleepRepository(db),
	eventWait: createEventWaitRepository(db),
	childWorkflowRunWait: createChildWorkflowRunWaitRepository(db),
	workflowRunOutbox: createWorkflowRunOutboxRepository(db),
});

export function createPgRepos(client: PgClient): Repositories {
	const db = createPgHandle(client);
	return {
		...createRepos(db),
		async transaction<T>(fn: (txRepos: Omit<Repositories, "transaction">) => Promise<T>): Promise<T> {
			return db.transaction(async (tx) => fn(createRepos(tx)));
		},
	};
}
