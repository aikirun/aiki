import type { ScheduleState } from "@aikirun/types/schedule";
import type { WorkflowRunState } from "@aikirun/types/workflow/run";
import type { TaskState } from "@aikirun/types/workflow/task";

import type {
	ScheduleStateTransitionRow,
	StateTransitionRow,
	StateTransitionRowSelect,
	TaskStateTransitionRow,
	WorkflowRunStateTransitionRow,
} from "./types/state-transition";

/**
 * JSON cannot represent `undefined` — keys with `undefined` values are dropped on insert.
 * These functions restore missing keys when reading JSON data back from the database,
 * ensuring the returned objects conform to their domain types.
 */

export function toWorkflowRunState(raw: unknown): WorkflowRunState {
	const state = raw as Record<string, unknown>;
	if (state.status === "completed" && !("output" in state)) {
		state.output = undefined;
	}
	return state as unknown as WorkflowRunState;
}

export function toTaskState(raw: unknown): TaskState {
	const state = raw as Record<string, unknown>;
	if (state.status === "completed" && !("output" in state)) {
		state.output = undefined;
	}
	return state as unknown as TaskState;
}

export function toStateTransitionRow(row: StateTransitionRowSelect): StateTransitionRow {
	const { id, status, revision, createdAt } = row;
	switch (row.type) {
		case "workflow_run": {
			if (row.workflowRunId === null || row.attempt === null || row.taskId !== null || row.scheduleId !== null) {
				throw new Error(`State transition ${id} has columns that do not match type 'workflow_run'`);
			}
			return {
				id,
				status,
				revision,
				createdAt,
				type: "workflow_run",
				workflowRunId: row.workflowRunId,
				attempt: row.attempt,
				taskId: null,
				scheduleId: null,
				state: toWorkflowRunState(row.state),
			};
		}
		case "task": {
			if (row.workflowRunId === null || row.attempt === null || row.taskId === null || row.scheduleId !== null) {
				throw new Error(`State transition ${id} has columns that do not match type 'task'`);
			}
			return {
				id,
				status,
				revision,
				createdAt,
				type: "task",
				workflowRunId: row.workflowRunId,
				attempt: row.attempt,
				taskId: row.taskId,
				scheduleId: null,
				state: toTaskState(row.state),
			};
		}
		case "schedule": {
			if (row.scheduleId === null || row.workflowRunId !== null || row.attempt !== null || row.taskId !== null) {
				throw new Error(`State transition ${id} has columns that do not match type 'schedule'`);
			}
			return {
				id,
				status,
				revision,
				createdAt,
				type: "schedule",
				workflowRunId: null,
				attempt: null,
				taskId: null,
				scheduleId: row.scheduleId,
				state: row.state as ScheduleState,
			};
		}
		default: {
			return row.type satisfies never;
		}
	}
}

export function toRunOwnedStateTransitionRow(
	row: StateTransitionRowSelect
): WorkflowRunStateTransitionRow | TaskStateTransitionRow {
	const narrowed = toStateTransitionRow(row);
	if (narrowed.type !== "workflow_run" && narrowed.type !== "task") {
		throw new Error(`State transition ${row.id} doesn't belong to a run`);
	}
	return narrowed;
}

export function toScheduleStateTransitionRow(row: StateTransitionRowSelect): ScheduleStateTransitionRow {
	const narrowed = toStateTransitionRow(row);
	if (narrowed.type !== "schedule") {
		throw new Error(`State transition ${row.id} doesn't belong to a schedule`);
	}
	return narrowed;
}
