import { getTaskAddress } from "@aikirun/lib/address";
import { isNonEmptyArray } from "@aikirun/lib/array";
import { hashInput } from "@aikirun/lib/crypto";
import type { EventReferenceOptions } from "@aikirun/types/event";
import type { TaskId, TaskState } from "@aikirun/types/task";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId, WorkflowRunTransition } from "@aikirun/types/workflow-run";
import { NotFoundError, ValidationError } from "server/errors";
import {
	findTaskById,
	workflowRunsById,
	workflowRunsByReferenceId,
	workflowRunTransitionsById,
} from "server/infrastructure/persistence/in-memory-store";
import type { ServerContext } from "server/middleware";
import { transitionTaskState } from "server/services/task-state-machine";
import { createWorkflowRun } from "server/services/workflow-run";
import { transitionWorkflowRunState } from "server/services/workflow-run-state-machine";

import { baseImplementer } from "./base";

const os = baseImplementer.workflowRun;

const listV1 = os.listV1.handler(({ input: request }) => {
	const { filters, limit = 50, offset = 0, sort } = request;

	let runs: Iterable<WorkflowRun>;
	if (filters?.runId) {
		const run = workflowRunsById.get(filters.runId as WorkflowRunId);
		runs = run ? [run] : [];
	} else {
		runs = workflowRunsById.values();
	}

	const filteredRuns: WorkflowRun[] = [];

	for (const run of runs) {
		if (filters?.status && !filters.status.includes(run.state.status)) {
			continue;
		}

		if (filters?.workflows && isNonEmptyArray(filters.workflows)) {
			const matchesAnyWorkflowFilter = filters.workflows.some(
				(w) =>
					w.name === run.name &&
					(!w.versionId || w.versionId === run.versionId) &&
					(!w.referenceId || w.referenceId === run.options.reference?.id)
			);
			if (!matchesAnyWorkflowFilter) {
				continue;
			}
		}

		filteredRuns.push(run);
	}

	return {
		runs: filteredRuns
			.sort((a, b) => (sort?.order === "asc" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
			.slice(offset, offset + limit)
			.map((run) => ({
				id: run.id,
				name: run.name,
				versionId: run.versionId,
				createdAt: run.createdAt,
				status: run.state.status,
				referenceId: run.options.reference?.id,
			})),
		total: filteredRuns.length,
	};
});

const getByIdV1 = os.getByIdV1.handler(({ input: request }) => {
	const run = workflowRunsById.get(request.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${request.id}`);
	}

	return { run };
});

const getByReferenceIdV1 = os.getByReferenceIdV1.handler(({ input: request }) => {
	const name = request.name as WorkflowName;
	const versionId = request.versionId as WorkflowVersionId;
	const referenceId = request.referenceId;

	const runId = workflowRunsByReferenceId.get(name)?.get(versionId)?.get(referenceId);
	if (!runId) {
		throw new NotFoundError(`Workflow run not found for reference: ${name}/${versionId}/${referenceId}`);
	}

	const run = workflowRunsById.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	return { run };
});

const getStateV1 = os.getStateV1.handler(({ input: request }) => {
	const run = workflowRunsById.get(request.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${request.id}`);
	}

	return { state: run.state };
});

const createV1 = os.createV1.handler(async ({ input: request, context }) => {
	const run = await createWorkflowRun(context, request);
	return { run };
});

const transitionStateV1 = os.transitionStateV1.handler(async ({ input: request, context }) => {
	return transitionWorkflowRunState(context, request);
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(async ({ input: request, context }) => {
	return transitionTaskState(context, request);
});

const setTaskStateV1 = os.setTaskStateV1.handler(async ({ input: request, context }) => {
	const runId = request.id as WorkflowRunId;

	const run = workflowRunsById.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const now = Date.now();

	if (request.type === "new") {
		const inputHash = await hashInput(request.input);
		const taskAddress = getTaskAddress(request.taskName, request.reference?.id ?? inputHash);

		const existingTaskInfo = run.tasks[taskAddress];
		if (existingTaskInfo) {
			throw new ValidationError(`Task ${taskAddress} already exists. Use type: "existing" to update it.`);
		}

		const taskId = crypto.randomUUID();

		context.logger.info({ runId, taskId, state: request.state }, "Setting task state (new task)");

		const runningState: TaskState = {
			status: "running",
			attempts: 1,
			input: request.input,
		};

		const runningTransition: WorkflowRunTransition = {
			id: crypto.randomUUID(),
			type: "task_state",
			createdAt: now,
			taskId,
			taskState: runningState,
		};

		const finalState: TaskState =
			request.state.status === "completed"
				? { status: "completed", attempts: 1, output: request.state.output }
				: { status: request.state.status satisfies "failed", attempts: 1, error: request.state.error };

		const finalTransition: WorkflowRunTransition = {
			id: crypto.randomUUID(),
			type: "task_state",
			createdAt: now,
			taskId,
			taskState: finalState,
		};

		const transitions = workflowRunTransitionsById.get(runId);
		if (!transitions) {
			workflowRunTransitionsById.set(runId, [runningTransition, finalTransition]);
		} else {
			transitions.push(runningTransition, finalTransition);
		}

		run.tasks[taskAddress] = { id: taskId, name: request.taskName, state: finalState, inputHash };
		run.revision++;

		return { run };
	}

	const existingTaskInfo = findTaskById(run, request.taskId as TaskId);
	if (!existingTaskInfo) {
		throw new NotFoundError(`Task not found: ${request.taskId}`);
	}

	context.logger.info({ runId, taskId: request.taskId, state: request.state }, "Setting task state (existing task)");

	const attempts = existingTaskInfo.state.attempts;

	const finalState: TaskState =
		request.state.status === "completed"
			? { status: "completed", attempts: attempts + 1, output: request.state.output }
			: { status: request.state.status satisfies "failed", attempts: attempts + 1, error: request.state.error };

	const finalTransition: WorkflowRunTransition = {
		id: crypto.randomUUID(),
		type: "task_state",
		createdAt: now,
		taskId: existingTaskInfo.id,
		taskState: finalState,
	};

	const transitions = workflowRunTransitionsById.get(runId);
	if (!transitions) {
		workflowRunTransitionsById.set(runId, [finalTransition]);
	} else {
		transitions.push(finalTransition);
	}

	run.tasks[existingTaskInfo.address] = {
		id: existingTaskInfo.id,
		name: existingTaskInfo.name,
		state: finalState,
		inputHash: existingTaskInfo.inputHash,
	};
	run.revision++;

	return { run };
});

const listTransitionsV1 = os.listTransitionsV1.handler(({ input: request }) => {
	const { id, limit = 50, offset = 0, sort } = request;

	const run = workflowRunsById.get(id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${id}`);
	}

	const transitions = workflowRunTransitionsById.get(id as WorkflowRunId) ?? [];

	return {
		transitions: [...transitions]
			.sort((a, b) => (sort?.order === "asc" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
			.slice(offset, offset + limit),
		total: transitions.length,
	};
});

async function sendEventToWorkflowRun(
	context: ServerContext,
	run: WorkflowRun<unknown, unknown>,
	receivedAt: number,
	eventName: string,
	data: unknown,
	reference: EventReferenceOptions | undefined
): Promise<void> {
	let eventQueue = run.eventsQueue[eventName];
	if (!eventQueue) {
		eventQueue = { events: [] };
		run.eventsQueue[eventName] = eventQueue;
	}

	if (reference) {
		const isDuplicate = eventQueue.events.some(
			(event) => event.status === "received" && event.reference?.id === reference.id
		);
		if (isDuplicate) {
			context.logger.info({ runId: run.id, eventName, referenceId: reference.id }, "Duplicate event, ignoring");
			return;
		}
	}

	eventQueue.events.push({
		status: "received",
		data,
		receivedAt,
		reference,
	});

	context.logger.info({ runId: run.id, eventName }, "Event sent to workflow run");

	if (run.state.status === "awaiting_event" && run.state.eventName === eventName) {
		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "event" },
			expectedRevision: run.revision,
		});
	}
}

const sendEventV1 = os.sendEventV1.handler(async ({ input: request, context }) => {
	const runId = request.id as WorkflowRunId;

	const run = workflowRunsById.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const { eventName, data, options } = request;
	const now = Date.now();

	await sendEventToWorkflowRun(context, run, now, eventName, data, options?.reference);

	return { run };
});

const multicastEventV1 = os.multicastEventV1.handler(async ({ input: request, context }) => {
	const runIds = request.ids as WorkflowRunId[];

	const runs = runIds.map((runId) => {
		const run = workflowRunsById.get(runId);
		if (!run) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		return run;
	});

	const { eventName, data, options } = request;
	const now = Date.now();

	for (const run of runs) {
		await sendEventToWorkflowRun(context, run, now, eventName, data, options?.reference);
	}
});

export const workflowRunRouter = os.router({
	listV1,
	getByIdV1,
	getByReferenceIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	transitionTaskStateV1,
	setTaskStateV1,
	listTransitionsV1,
	sendEventV1,
	multicastEventV1,
});
