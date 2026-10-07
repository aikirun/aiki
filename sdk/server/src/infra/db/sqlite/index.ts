import type { SqliteClient } from "@aikirun/lib/db/sqlite";

import { createSqliteHandle, type SqliteDb } from "./provider";
import { createChildWorkflowRunWaitRepository } from "./repository/child-workflow-run-wait";
import { createEventWaitRepository } from "./repository/event-wait";
import { createScheduleRepository } from "./repository/schedule";
import { createSleepRepository } from "./repository/sleep";
import { createStateTransitionRepository } from "./repository/state-transition";
import { createTaskRepository } from "./repository/task";
import { createWorkflowRepository } from "./repository/workflow";
import { createWorkflowRunRepository } from "./repository/workflow-run";
import { createWorkflowRunOutboxRepository } from "./repository/workflow-run-outbox";
import type { Repositories, TxRepositories } from "../types";

const createRepos = (db: SqliteDb): Omit<Repositories, "transaction"> => ({
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

export function createSqliteRepos(client: SqliteClient): Repositories {
	const db = createSqliteHandle(client);
	return {
		...createRepos(db),
		async transaction<T>(fn: (txRepos: TxRepositories) => Promise<T>): Promise<T> {
			const effects: Array<() => void> = [];
			const transaction = await client.transaction();
			let result: T;
			try {
				const txRepos = Object.assign(createRepos(createSqliteHandle(transaction)), {
					onCommit: (effect: () => void): void => {
						effects.push(effect);
					},
				}) as TxRepositories;
				result = await fn(txRepos);
				await transaction.commit();
			} catch (error) {
				await transaction.rollback();
				throw error;
			}
			for (const effect of effects) {
				effect();
			}
			return result;
		},
	};
}
