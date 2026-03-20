import type { PgDatabaseConn, PgDb } from "./provider";
import { createApiKeyRepository } from "./repository/api-key";
import { createChildWorkflowRunWaitQueueRepository } from "./repository/child-workflow-run-wait-queue";
import { createEventWaitQueueRepository } from "./repository/event-wait-queue";
import { createNamespaceRepository } from "./repository/namespace";
import { createOrganizationRepository } from "./repository/organization";
import { createScheduleRepository } from "./repository/schedule";
import { createSessionRepository } from "./repository/session";
import { createSleepQueueRepository } from "./repository/sleep-queue";
import { createStateTransitionRepository } from "./repository/state-transition";
import { createTaskRepository } from "./repository/task";
import { createWorkflowRepository } from "./repository/workflow";
import { createWorkflowRunRepository } from "./repository/workflow-run";
import { createWorkflowRunOutboxRepository } from "./repository/workflow-run-outbox";
import type { Repositories } from "../types";

export function createPgRepositories(db: PgDatabaseConn): Repositories {
	return {
		...createRepos(db),
		async transaction<T>(fn: (txRepos: Omit<Repositories, "transaction">) => Promise<T>): Promise<T> {
			return db.transaction(async (tx) => fn(createRepos(tx)));
		},
	};
}

function createRepos(db: PgDb): Omit<Repositories, "transaction"> {
	return {
		workflowRun: createWorkflowRunRepository(db),
		task: createTaskRepository(db),
		stateTransition: createStateTransitionRepository(db),
		schedule: createScheduleRepository(db),
		workflow: createWorkflowRepository(db),
		sleepQueue: createSleepQueueRepository(db),
		eventWaitQueue: createEventWaitQueueRepository(db),
		childWorkflowRunWaitQueue: createChildWorkflowRunWaitQueueRepository(db),
		workflowRunOutbox: createWorkflowRunOutboxRepository(db),
		namespace: createNamespaceRepository(db),
		organization: createOrganizationRepository(db),
		session: createSessionRepository(db),
		apiKey: createApiKeyRepository(db),
	};
}
