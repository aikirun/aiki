import { getTaskAddress, getWorkflowRunAddress } from "@aikirun/lib/address";
import { isNonEmptyArray } from "@aikirun/lib/array";
import { hashInput } from "@aikirun/lib/crypto";
import { toMilliseconds } from "@aikirun/lib/duration";
import { propsRequiredNonNull } from "@aikirun/lib/object";
import type { EventReferenceOptions, EventWaitQueue } from "@aikirun/types/event";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { SleepQueue } from "@aikirun/types/sleep";
import type { TaskInfo, TaskQueue, TaskState, TaskStatus } from "@aikirun/types/task";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type {
	ChildWorkflowRunInfo,
	ChildWorkflowRunQueue,
	ChildWorkflowRunWaitQueue,
	TerminalWorkflowRunState,
	TerminalWorkflowRunStatus,
	WorkflowRun,
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateCancelled,
	WorkflowStartOptions,
} from "@aikirun/types/workflow-run";
import type {
	WorkflowRunCancelByIdsRequestV1,
	WorkflowRunCreateRequestV1,
	WorkflowRunListChildRunsRequestV1,
	WorkflowRunListRequestV1,
	WorkflowRunListResponseV1,
	WorkflowRunListTransitionsRequestV1,
	WorkflowRunReference,
	WorkflowRunSetTaskStateRequestV1,
} from "@aikirun/types/workflow-run-api";
import { NotFoundError, WorkflowRunConflictError } from "server/errors";
import type {
	ChildWorkflowRunWaitQueueRow,
	EventWaitQueueRow,
	EventWaitQueueRowInsert,
	Repositories,
	SleepQueueRow,
	StateTransitionRepository,
	StateTransitionRow,
	StateTransitionRowInsert,
	TaskRow,
	WorkflowRepository,
	WorkflowRow,
	WorkflowRunRow,
} from "server/infra/db/types";
import type { NamespaceRequestContext } from "server/middleware/context";
import type { CancelledParentRun, ChildRunCanceller } from "server/service/cancel-child-runs";
import type { WorkflowRunStateMachineService } from "server/service/workflow-run-state-machine";
import { monotonicFactory, ulid } from "ulidx";

export interface WorkflowRunServiceDeps {
	repos: Pick<
		Repositories,
		| "workflowRun"
		| "workflow"
		| "stateTransition"
		| "task"
		| "sleepQueue"
		| "eventWaitQueue"
		| "childWorkflowRunWaitQueue"
		| "transaction"
	>;
	childRunCanceller: ChildRunCanceller;
	workflowRunStateMachineService: WorkflowRunStateMachineService;
}

export function createWorkflowRunService(deps: WorkflowRunServiceDeps) {
	const { repos, childRunCanceller, workflowRunStateMachineService } = deps;

	const monotonic = monotonicFactory();

	async function createWorkflowRun(
		context: NamespaceRequestContext,
		request: WorkflowRunCreateRequestV1
	): Promise<WorkflowRunId> {
		const inputHash = await hashInput(request.input);
		return repos.transaction(async (txRepos) => createWorkflowRunInTx(context, request, inputHash, txRepos));
	}

	async function getWorkflowRunById(context: NamespaceRequestContext, id: string): Promise<WorkflowRun> {
		const { namespaceId } = context;

		const runRow = await repos.workflowRun.getById(namespaceId, id);
		if (!runRow) {
			throw new NotFoundError(`Workflow run not found: ${id}`);
		}

		const workflowRow = await repos.workflow.getById(namespaceId, runRow.workflowId);
		if (!workflowRow) {
			throw new NotFoundError(`Workflow not found for run: ${id}`);
		}

		return getWorkflowRun(namespaceId, workflowRow, runRow);
	}

	async function getWorkflowRunByReferenceId(
		context: NamespaceRequestContext,
		filter: WorkflowRunReference
	): Promise<WorkflowRun> {
		const { namespaceId } = context;
		const { name, versionId, referenceId } = filter;

		const workflowRow = await repos.workflow.getByNameAndVersion(namespaceId, { name, versionId, source: "user" });
		if (!workflowRow) {
			throw new NotFoundError(`Workflow not found: ${name}:${versionId}`);
		}

		const runRow = await repos.workflowRun.getByWorkflowAndReferenceId(workflowRow.id, referenceId);
		if (!runRow) {
			throw new NotFoundError(`Workflow run not found for reference: ${name}:${versionId}:${referenceId}`);
		}

		return getWorkflowRun(namespaceId, workflowRow, runRow);
	}

	async function getWorkflowRun(
		namespaceId: NamespaceId,
		workflowRow: WorkflowRow,
		runRow: WorkflowRunRow
	): Promise<WorkflowRun> {
		const [latestTransition, taskRows, sleepRows, eventWaitRows, childRunRows, childWorkflowRunWaitRows] =
			await Promise.all([
				repos.stateTransition.getById(runRow.latestStateTransitionId),
				repos.task.listByWorkflowRunId(runRow.id),
				repos.sleepQueue.listByWorkflowRunId(runRow.id as WorkflowRunId),
				repos.eventWaitQueue.listByWorkflowRunId(runRow.id),
				repos.workflowRun.getChildRuns({ parentRunId: runRow.id }),
				repos.childWorkflowRunWaitQueue.listByParentRunId(runRow.id),
			]);

		if (!latestTransition) {
			throw new Error(`State transition not found: ${runRow.latestStateTransitionId}`);
		}

		const taskTransitionIds = taskRows.map((task) => task.latestStateTransitionId);
		const taskTransitionRows = isNonEmptyArray(taskTransitionIds)
			? await repos.stateTransition.getByIds(taskTransitionIds)
			: [];
		const taskTransitionsById = new Map(taskTransitionRows.map((transition) => [transition.id, transition]));

		const tasksByAddress = buildTaskQueuesByAddressRecord(taskRows, taskTransitionsById);
		const sleepQueuesByName = buildSleepQueuesByNameRecord(sleepRows);
		const eventWaitQueuesByName = buildEventWaitQueuesByNameRecord(eventWaitRows);
		const childWorkflowRunsByAddress = await buildChildWorkflowRunQueuesByAddressRecord(
			namespaceId,
			childRunRows,
			childWorkflowRunWaitRows,
			repos.stateTransition,
			repos.workflow
		);

		return {
			id: runRow.id,
			name: workflowRow.name,
			versionId: workflowRow.versionId,
			createdAt: runRow.createdAt.getTime(),
			revision: runRow.revision,
			stateTransitionId: runRow.latestStateTransitionId,
			input: runRow.input,
			inputHash: runRow.inputHash,
			options: runRow.options as WorkflowStartOptions | undefined,
			attempts: runRow.attempts,
			state: latestTransition.state as WorkflowRunState,
			taskQueues: tasksByAddress,
			sleepQueues: sleepQueuesByName,
			eventWaitQueues: eventWaitQueuesByName,
			childWorkflowRunQueues: childWorkflowRunsByAddress,
			parentWorkflowRunId: runRow.parentWorkflowRunId ?? undefined,
			scheduleId: runRow.scheduleId ?? undefined,
		};
	}

	async function getWorkflowRunState(context: NamespaceRequestContext, id: string): Promise<WorkflowRunState> {
		const runRow = await repos.workflowRun.getById(context.namespaceId, id);
		if (!runRow) {
			throw new NotFoundError(`Workflow run not found: ${id}`);
		}

		const transition = await repos.stateTransition.getById(runRow.latestStateTransitionId);
		if (!transition) {
			throw new Error(`State transition not found: ${runRow.latestStateTransitionId}`);
		}
		return transition.state as WorkflowRunState;
	}

	async function listWorkflowRuns(
		context: NamespaceRequestContext,
		request: WorkflowRunListRequestV1
	): Promise<WorkflowRunListResponseV1> {
		const { namespaceId } = context;
		const { filters, sort, limit = 50, offset = 0 } = request;
		const workflowFilter = filters?.workflow;

		const workflows = workflowFilter
			? "versionId" in workflowFilter
				? await repos.workflow.listByNameAndVersion(namespaceId, {
						name: workflowFilter.name,
						versionId: workflowFilter.versionId,
						source: workflowFilter.source,
					})
				: await repos.workflow.listByNameAndVersion(namespaceId, {
						name: workflowFilter.name,
						source: workflowFilter.source,
					})
			: undefined;
		const workflowIds = workflows?.map((workflow) => workflow.id);

		const { rows, total } = workflowFilter
			? isNonEmptyArray(workflowIds)
				? await repos.workflowRun.listByFilters(
						namespaceId,
						{
							id: filters?.id,
							scheduleId: filters?.scheduleId,
							status: isNonEmptyArray(filters?.status) ? filters.status : undefined,
							workflow: {
								ids: workflowIds,
								referenceId: "referenceId" in workflowFilter ? workflowFilter.referenceId : undefined,
							},
						},
						limit,
						offset,
						{ order: sort?.order ?? "desc" }
					)
				: { rows: [], total: 0 }
			: await repos.workflowRun.listByFilters(
					namespaceId,
					{
						id: filters?.id,
						scheduleId: filters?.scheduleId,
						status: isNonEmptyArray(filters?.status) ? filters.status : undefined,
					},
					limit,
					offset,
					{ order: sort?.order ?? "desc" }
				);

		const runIds = rows.map((row) => row.id);
		const taskCountsByRunId = isNonEmptyArray(runIds)
			? await repos.workflowRun.getTaskCountsByRunIds(runIds)
			: new Map<string, Record<TaskStatus, number>>();

		return {
			runs: rows.map((row) => ({
				id: row.id,
				name: row.name,
				versionId: row.versionId,
				createdAt: row.createdAt.getTime(),
				status: row.status,
				referenceId: row.referenceId ?? undefined,
				taskCounts: taskCountsByRunId.get(row.id),
			})),
			total,
		};
	}

	async function listWorkflowRunTransitions(
		context: NamespaceRequestContext,
		request: WorkflowRunListTransitionsRequestV1
	) {
		const { id, limit, offset, sort } = request;
		const runExists = await repos.workflowRun.exists(context.namespaceId, id);
		if (!runExists) {
			throw new NotFoundError(`Workflow run not found: ${id}`);
		}

		const { rows, total } = await repos.stateTransition.listByRunId(id, limit, offset, sort);

		return {
			transitions: rows.map((row) => {
				if (row.type === "task") {
					if (!row.taskId) {
						throw new Error(`State transition ${row.id} is of type 'task' but has no taskId`);
					}
					return {
						id: row.id,
						type: row.type,
						createdAt: row.createdAt.getTime(),
						taskId: row.taskId,
						taskState: row.state as TaskState,
					};
				}
				return {
					id: row.id,
					type: row.type satisfies "workflow_run",
					createdAt: row.createdAt.getTime(),
					state: row.state as WorkflowRunState,
				};
			}),
			total,
		};
	}

	async function sendEventToWorkflowRun(
		context: NamespaceRequestContext,
		runId: WorkflowRunId,
		eventName: string,
		data: unknown,
		reference: EventReferenceOptions | undefined
	): Promise<void> {
		return repos.transaction(async (txRepos) => {
			// TODO: should we use getByIdWithState instead?
			// Con: extra join to get state is pointless if the run is not in awaiting_event state
			// Pro: If run is awaiting_event, no extra network call to fetch state
			const run = await txRepos.workflowRun.getById(context.namespaceId, runId);
			if (!run) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}

			const eventWaitEntry: EventWaitQueueRowInsert = {
				id: ulid(),
				workflowRunId: runId,
				name: eventName,
				status: "received",
				referenceId: reference?.id,
				data,
			};
			if (propsRequiredNonNull(eventWaitEntry, "referenceId")) {
				await txRepos.eventWaitQueue.upsert(eventWaitEntry);
			} else {
				await txRepos.eventWaitQueue.insert(eventWaitEntry);
			}

			if (run.status !== "awaiting_event") {
				return;
			}

			const latestStateTransition = await txRepos.stateTransition.getById(run.latestStateTransitionId);
			if (!latestStateTransition) {
				throw new Error(`State transition not found: ${run.latestStateTransitionId}`);
			}
			const currentState = latestStateTransition.state as WorkflowRunState;

			if (currentState.status === "awaiting_event" && currentState.eventName === eventName) {
				await workflowRunStateMachineService.transitionState(
					context,
					{
						type: "optimistic",
						id: runId,
						state: { status: "scheduled", scheduledInMs: 0, reason: "event" },
						expectedRevision: run.revision,
					},
					txRepos
				);
			}
		});
	}

	async function resolveRunIdsByReferences(
		context: NamespaceRequestContext,
		references: WorkflowRunReference[]
	): Promise<WorkflowRunId[]> {
		const { namespaceId } = context;

		const nameAndVersionIdPairsByKey = new Map<string, { name: string; versionId: string; source: "user" }>();
		for (const { name, versionId } of references) {
			const key = `${name}:${versionId}`;
			if (!nameAndVersionIdPairsByKey.has(key)) {
				nameAndVersionIdPairsByKey.set(key, { name, versionId, source: "user" });
			}
		}
		const nameAndVersionIdPairs = [...nameAndVersionIdPairsByKey.values()];
		if (!isNonEmptyArray(nameAndVersionIdPairs)) {
			return [];
		}

		const workflows = await repos.workflow.listByNameAndVersionPairs(namespaceId, nameAndVersionIdPairs);
		const workflowsByKey = new Map(workflows.map((workflow) => [`${workflow.name}:${workflow.versionId}`, workflow]));

		const workflowIdAndReferenceIdPairs = references.map(({ name, versionId, referenceId }) => {
			const workflow = workflowsByKey.get(`${name}:${versionId}`);
			if (!workflow) {
				throw new NotFoundError(`Workflow not found: ${name}:${versionId}`);
			}
			return { workflowId: workflow.id, referenceId };
		});
		if (!isNonEmptyArray(workflowIdAndReferenceIdPairs)) {
			return [];
		}

		const runs = await repos.workflowRun.listByWorkflowAndReferenceIdPairs({ pairs: workflowIdAndReferenceIdPairs });
		const runsByKey = new Map(
			runs.reduce<[string, WorkflowRunRow][]>((acc, run) => {
				if (run.referenceId !== null) {
					acc.push([`${run.workflowId}:${run.referenceId}`, run]);
				}
				return acc;
			}, [])
		);

		// Map back to original order, throwing for missing runs
		return references.map(({ name, versionId, referenceId }) => {
			const workflow = workflowsByKey.get(`${name}:${versionId}`);
			if (!workflow) {
				throw new NotFoundError(`Workflow not found: ${name}:${versionId}`);
			}
			const run = runsByKey.get(`${workflow.id}:${referenceId}`);
			if (!run) {
				throw new NotFoundError(`Workflow run not found: ${name}:${versionId}:${referenceId}`);
			}
			return run.id as WorkflowRunId;
		});
	}

	async function setTaskState(
		context: NamespaceRequestContext,
		request: WorkflowRunSetTaskStateRequestV1
	): Promise<void> {
		const runId = request.id as WorkflowRunId;

		return repos.transaction(async (txRepos) => {
			const run = await txRepos.workflowRun.getById(context.namespaceId, runId);
			if (!run) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}

			if (request.type === "new") {
				const inputHash = await hashInput(request.input);

				const taskId = ulid();
				const runningStateTransitionId = monotonic();
				const finalStateTransitionId = monotonic();

				context.logger.info({ runId, taskId, state: request.state }, "Setting task state (new task)");

				const runningState: TaskState = {
					status: "running",
					attempts: 1,
					input: request.input,
				};

				const finalState: TaskState =
					request.state.status === "completed"
						? { status: "completed", attempts: 1, output: request.state.output }
						: { status: request.state.status satisfies "failed", attempts: 1, error: request.state.error };

				await txRepos.task.create({
					id: taskId,
					name: request.taskName,
					workflowRunId: runId,
					status: finalState.status,
					attempts: 1,
					input: request.input,
					inputHash: inputHash,
					options: null,
					latestStateTransitionId: finalStateTransitionId,
				});
				await txRepos.stateTransition.append({
					id: runningStateTransitionId,
					workflowRunId: runId,
					type: "task",
					taskId,
					status: runningState.status,
					attempt: runningState.attempts,
					state: runningState,
				});
				await txRepos.stateTransition.append({
					id: finalStateTransitionId,
					workflowRunId: runId,
					type: "task",
					taskId,
					status: finalState.status,
					attempt: finalState.attempts,
					state: finalState,
				});

				return;
			}

			const existingTaskRow = await txRepos.task.getById(request.taskId);
			if (!existingTaskRow) {
				throw new NotFoundError(`Task not found: ${request.taskId}`);
			}

			context.logger.info(
				{ runId, taskId: request.taskId, state: request.state },
				"Setting task state (existing task)"
			);

			const attempts = existingTaskRow.attempts;

			const finalState: TaskState =
				request.state.status === "completed"
					? { status: "completed", attempts: attempts + 1, output: request.state.output }
					: { status: request.state.status satisfies "failed", attempts: attempts + 1, error: request.state.error };

			const finalTransitionId = ulid();
			await txRepos.stateTransition.append({
				id: finalTransitionId,
				workflowRunId: runId,
				type: "task",
				taskId: existingTaskRow.id,
				status: finalState.status,
				attempt: finalState.attempts,
				state: finalState,
			});

			await txRepos.task.update(existingTaskRow.id, {
				status: finalState.status,
				attempts: finalState.attempts,
				latestStateTransitionId: finalTransitionId,
			});
		});
	}

	async function listChildRuns(_context: NamespaceRequestContext, request: WorkflowRunListChildRunsRequestV1) {
		const childRuns = await repos.workflowRun.getChildRuns({
			parentRunId: request.parentRunId,
			status: isNonEmptyArray(request.status) ? request.status : undefined,
		});
		return {
			runs: childRuns.map((child) => {
				const shard = (child.options as WorkflowStartOptions | null)?.shard;
				return {
					id: child.id,
					options: shard ? { shard } : undefined,
				};
			}),
		};
	}

	async function cancelByIds(context: NamespaceRequestContext, request: WorkflowRunCancelByIdsRequestV1) {
		const ids = request.ids;
		if (!isNonEmptyArray(ids)) {
			return { cancelledIds: [] };
		}

		return repos.transaction(async (txRepos) => {
			const cancelledRunIds = await txRepos.workflowRun.bulkTransitionToCancelled(ids);
			if (!isNonEmptyArray(cancelledRunIds)) {
				return { cancelledIds: [] };
			}

			const cancelledRuns = await txRepos.workflowRun.getByIds(context.namespaceId, cancelledRunIds);

			const cancelStateTransitionEntries: StateTransitionRowInsert[] = [];
			const cancelledRunStateTransitionUpdates: { id: string; stateTransitionId: string }[] = [];
			const cancelledParentRuns: CancelledParentRun[] = [];

			for (const run of cancelledRuns) {
				const stateTransitionId = ulid();
				cancelStateTransitionEntries.push({
					id: stateTransitionId,
					workflowRunId: run.id,
					type: "workflow_run",
					status: "cancelled",
					attempt: run.attempts,
					state: { status: "cancelled", reason: "Bulk cancel" } satisfies WorkflowRunStateCancelled,
				});
				cancelledRunStateTransitionUpdates.push({ id: run.id, stateTransitionId });
				cancelledParentRuns.push({
					namespaceId: context.namespaceId,
					runId: run.id,
					shard: (run.options as WorkflowStartOptions | null)?.shard,
				});
			}

			if (isNonEmptyArray(cancelStateTransitionEntries) && isNonEmptyArray(cancelledRunStateTransitionUpdates)) {
				await txRepos.stateTransition.appendBatch(cancelStateTransitionEntries);
				await txRepos.workflowRun.bulkSetLatestStateTransitionId(cancelledRunStateTransitionUpdates);
			}

			if (isNonEmptyArray(cancelledParentRuns)) {
				await childRunCanceller.cancel(cancelledParentRuns, txRepos, context.logger);
			}

			return { cancelledIds: cancelledRunIds };
		});
	}

	async function hasTerminated(context: NamespaceRequestContext, runId: string, afterStateTransitionId: string) {
		const result = await repos.stateTransition.hasTerminated(context.namespaceId, runId, afterStateTransitionId);
		if (!result.runFound) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		return {
			terminated: result.terminated,
			latestStateTransitionId: result.latestStateTransitionId,
		};
	}

	return {
		createWorkflowRun: createWorkflowRun,
		getWorkflowRunById: getWorkflowRunById,
		getWorkflowRunByReferenceId: getWorkflowRunByReferenceId,
		getWorkflowRunState: getWorkflowRunState,
		listWorkflowRuns: listWorkflowRuns,
		listWorkflowRunTransitions: listWorkflowRunTransitions,
		sendEventToWorkflowRun: sendEventToWorkflowRun,
		resolveRunIdsByReferences: resolveRunIdsByReferences,
		setTaskState: setTaskState,
		listChildRuns: listChildRuns,
		cancelByIds: cancelByIds,
		hasTerminated: hasTerminated,
	};
}

export type WorkflowRunService = ReturnType<typeof createWorkflowRunService>;

async function createWorkflowRunInTx(
	context: NamespaceRequestContext,
	request: WorkflowRunCreateRequestV1,
	inputHash: string,
	txRepos: Pick<Repositories, "workflowRun" | "workflow" | "stateTransition">
): Promise<WorkflowRunId> {
	const namespaceId = context.namespaceId;
	const name = request.name as WorkflowName;
	const versionId = request.versionId as WorkflowVersionId;
	const parentWorkflowRunId = request.parentWorkflowRunId as WorkflowRunId | undefined;
	const { input, options } = request;
	const referenceId = options?.reference?.id;

	const workflow = await txRepos.workflow.getOrCreate({ namespaceId, name, versionId, source: "user" });

	if (referenceId) {
		const existingRun = await txRepos.workflowRun.getByWorkflowAndReferenceId(workflow.id, referenceId);
		if (existingRun) {
			if (existingRun.inputHash !== inputHash) {
				const conflictPolicy = options?.reference?.conflictPolicy ?? "error";
				if (conflictPolicy === "error") {
					throw new WorkflowRunConflictError(name, versionId, referenceId);
				}
			}

			context.logger.info({ runId: existingRun.id, referenceId }, "Returning existing run from reference ID");
			return existingRun.id as WorkflowRunId;
		}
	}

	const now = Date.now();
	const runId = ulid() as WorkflowRunId;
	const trigger = options?.trigger;

	let scheduledAt = now;
	if (trigger && trigger.type === "delayed") {
		scheduledAt = "delayMs" in trigger ? now + trigger.delayMs : now + toMilliseconds(trigger.delay);
	}

	const transitionId = ulid();

	await txRepos.workflowRun.insert({
		id: runId,
		namespaceId,
		workflowId: workflow.id,
		parentWorkflowRunId,
		status: "scheduled",
		input,
		inputHash,
		options,
		referenceId,
		conflictPolicy: options?.reference?.conflictPolicy,
		latestStateTransitionId: transitionId,
		scheduledAt: new Date(scheduledAt),
	});

	const state = {
		status: "scheduled",
		scheduledAt,
		reason: "new",
	} as const;

	await txRepos.stateTransition.append({
		id: transitionId,
		workflowRunId: runId,
		type: "workflow_run",
		status: "scheduled",
		attempt: 0,
		state,
	});

	context.logger.info({ workflowName: name, versionId, runId, referenceId, options }, "Created workflow run");

	return runId;
}

function buildTaskQueuesByAddressRecord(
	tasks: TaskRow[],
	taskTransitionsById: Map<string, StateTransitionRow>
): Record<string, TaskQueue> {
	const taskQueuesByAddress: Record<string, TaskQueue> = {};
	for (const task of tasks) {
		const address = getTaskAddress(task.name, task.inputHash);
		const transition = taskTransitionsById.get(task.latestStateTransitionId);
		if (!transition) {
			throw new Error(`Task state transition not found: ${task.latestStateTransitionId}`);
		}
		const taskInfo: TaskInfo = {
			id: task.id,
			name: task.name,
			state: transition.state as TaskState,
			inputHash: task.inputHash,
		};
		const taskQueue = taskQueuesByAddress[address];
		if (taskQueue) {
			taskQueue.tasks.push(taskInfo);
		} else {
			taskQueuesByAddress[address] = { tasks: [taskInfo] };
		}
	}
	return taskQueuesByAddress;
}

function buildSleepQueuesByNameRecord(sleepQueueRows: SleepQueueRow[]): Record<string, SleepQueue> {
	const sleepQueuesByName: Record<string, SleepQueue> = {};

	for (const row of sleepQueueRows) {
		let queue = sleepQueuesByName[row.name];
		if (!queue) {
			queue = { sleeps: [] };
			sleepQueuesByName[row.name] = queue;
		}

		switch (row.status) {
			case "sleeping":
				queue.sleeps.push({ status: row.status, awakeAt: row.awakeAt.getTime() });
				break;
			case "completed": {
				const { completedAt } = row;
				if (completedAt === null) {
					throw Error(`Sleep ${row.id} completed but no completedAt timestamp`);
				}
				queue.sleeps.push({
					status: row.status,
					durationMs: completedAt.getTime() - row.createdAt.getTime(),
					completedAt: completedAt.getTime(),
				});
				break;
			}
			case "cancelled": {
				const { cancelledAt } = row;
				if (cancelledAt === null) {
					throw Error(`Sleep ${row.id} cancelled but no cancelledAt timestamp`);
				}
				queue.sleeps.push({ status: row.status, cancelledAt: cancelledAt.getTime() });
				break;
			}
			default:
				row.status satisfies never;
		}
	}

	return sleepQueuesByName;
}

function buildEventWaitQueuesByNameRecord(eventWaitRows: EventWaitQueueRow[]): Record<string, EventWaitQueue<unknown>> {
	const eventWaitQueuesByName: Record<string, EventWaitQueue<unknown>> = {};

	for (const row of eventWaitRows) {
		let queue = eventWaitQueuesByName[row.name];
		if (!queue) {
			queue = { eventWaits: [] };
			eventWaitQueuesByName[row.name] = queue;
		}

		switch (row.status) {
			case "received":
				queue.eventWaits.push({
					status: row.status,
					data: row.data,
					receivedAt: row.createdAt.getTime(),
					reference: row.referenceId ? { id: row.referenceId } : undefined,
				});
				break;
			case "timeout": {
				const { timedOutAt } = row;
				if (timedOutAt === null) {
					throw Error(`Event wait ${row.id} timed out but no timeoutAt timestamp`);
				}
				queue.eventWaits.push({
					status: row.status,
					timedOutAt: timedOutAt.getTime(),
				});
				break;
			}
			default:
				row.status satisfies never;
		}
	}

	return eventWaitQueuesByName;
}

async function buildChildWorkflowRunQueuesByAddressRecord(
	namespaceId: NamespaceId,
	childRuns: WorkflowRunRow[],
	childRunWaitQueues: ChildWorkflowRunWaitQueueRow[],
	stateTransitionRepo: StateTransitionRepository,
	workflowRepo: WorkflowRepository
): Promise<Record<string, ChildWorkflowRunQueue>> {
	const childStateTransitionIds = childRunWaitQueues.reduce((acc: string[], { childWorkflowRunStateTransitionId }) => {
		if (childWorkflowRunStateTransitionId !== null) {
			acc.push(childWorkflowRunStateTransitionId);
		}
		return acc;
	}, []);
	const childStateTransitions = isNonEmptyArray(childStateTransitionIds)
		? await stateTransitionRepo.getByIds(childStateTransitionIds)
		: [];
	const childStateTransitionsById = new Map(childStateTransitions.map((transition) => [transition.id, transition]));

	const waitQueuesByChildRunId = new Map<WorkflowRunId, Record<TerminalWorkflowRunStatus, ChildWorkflowRunWaitQueue>>();

	for (const childRunWaitQueue of childRunWaitQueues) {
		const childRunId = childRunWaitQueue.childWorkflowRunId as WorkflowRunId;

		let queues = waitQueuesByChildRunId.get(childRunId);
		if (!queues) {
			queues = {
				cancelled: { childWorkflowRunWaits: [] },
				completed: { childWorkflowRunWaits: [] },
				failed: { childWorkflowRunWaits: [] },
			};
			waitQueuesByChildRunId.set(childRunId, queues);
		}

		const { childWorkflowRunStatus } = childRunWaitQueue;

		switch (childRunWaitQueue.status) {
			case "completed": {
				const { completedAt, childWorkflowRunStateTransitionId } = childRunWaitQueue;
				if (completedAt === null) {
					throw new Error(`Child workflow run wait ${childRunWaitQueue.id} completed but no completedAt timestamp`);
				}
				if (childWorkflowRunStateTransitionId === null) {
					throw new Error(`Child workflow run wait ${childRunWaitQueue.id} completed but no state transition id`);
				}

				const childStateTransition = childStateTransitionsById.get(childWorkflowRunStateTransitionId);
				if (!childStateTransition) {
					throw new Error(`State transition not found: ${childWorkflowRunStateTransitionId}`);
				}

				queues[childWorkflowRunStatus].childWorkflowRunWaits.push({
					status: childRunWaitQueue.status,
					completedAt: completedAt.getTime(),
					childWorkflowRunState: childStateTransition.state as TerminalWorkflowRunState,
				});
				break;
			}
			case "timeout": {
				const { timedOutAt } = childRunWaitQueue;
				if (timedOutAt === null) {
					throw new Error(`Child workflow run wait ${childRunWaitQueue.id} timed out but no timedOutAt timestamp`);
				}

				queues[childWorkflowRunStatus].childWorkflowRunWaits.push({
					status: childRunWaitQueue.status,
					timedOutAt: timedOutAt.getTime(),
				});
				break;
			}
			default:
				childRunWaitQueue.status satisfies never;
		}
	}

	const childWorkflowIds = Array.from(new Set(childRuns.map((run) => run.workflowId)));
	const childWorkflows = isNonEmptyArray(childWorkflowIds)
		? await workflowRepo.getByIds(namespaceId, childWorkflowIds)
		: [];
	const childWorkflowsById = new Map(childWorkflows.map((workflow) => [workflow.id, workflow]));

	const childRunQueuesByAddress: Record<string, ChildWorkflowRunQueue> = {};

	for (const childRun of childRuns) {
		const childWorkflow = childWorkflowsById.get(childRun.workflowId);
		if (!childWorkflow) {
			throw new Error(`Workflow not found for child run: ${childRun.id}`);
		}

		const childRunAddress = getWorkflowRunAddress(
			childWorkflow.name,
			childWorkflow.versionId,
			childRun.referenceId ?? childRun.inputHash
		);

		const childRunInfo: ChildWorkflowRunInfo = {
			id: childRun.id,
			name: childWorkflow.name,
			versionId: childWorkflow.versionId,
			inputHash: childRun.inputHash,
			childWorkflowRunWaitQueues: waitQueuesByChildRunId.get(childRun.id as WorkflowRunId) ?? {
				cancelled: { childWorkflowRunWaits: [] },
				completed: { childWorkflowRunWaits: [] },
				failed: { childWorkflowRunWaits: [] },
			},
		};

		const childRunQueue = childRunQueuesByAddress[childRunAddress];
		if (childRunQueue) {
			childRunQueue.childWorkflowRuns.push(childRunInfo);
		} else {
			childRunQueuesByAddress[childRunAddress] = { childWorkflowRuns: [childRunInfo] };
		}
	}

	return childRunQueuesByAddress;
}
