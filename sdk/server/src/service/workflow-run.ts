import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import { toMilliseconds } from "@aikirun/lib/duration";
import { NotFoundError } from "@aikirun/lib/error";
import { getCompositeId } from "@aikirun/lib/id";
import { propsRequiredNonNull } from "@aikirun/lib/object";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type {
	WorkflowRunCancelByIdsRequestV1,
	WorkflowRunCreateRequestV1,
	WorkflowRunListChildRunsRequestV1,
	WorkflowRunListRequestV1,
	WorkflowRunListResponseV1,
	WorkflowRunListTransitionsRequestV1,
	WorkflowRunReference,
} from "@aikirun/types/api/workflow-run";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type {
	ChildWorkflowRunInfo,
	ChildWorkflowRunWait,
	EventReference,
	EventWait,
	Sleep,
	TerminalWorkflowRunState,
	TerminalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunRecord,
	WorkflowRunState,
	WorkflowRunStateCancelled,
	WorkflowRunStateScheduledByNew,
} from "@aikirun/types/workflow/run";
import type { TaskInfo, TaskState, TaskStateDiscarded, TaskStatus } from "@aikirun/types/workflow/task";
import { ulid } from "ulidx";

import type { WorkflowRunStateMachine } from "./state-machine/workflow-run";
import { WorkflowRunReferenceConflictError } from "../errors";
import type { Repositories } from "../infra/db/types";
import type { ChildWorkflowRunWaitRow } from "../infra/db/types/child-workflow-run-wait";
import type { EventWaitRow, EventWaitRowInsert } from "../infra/db/types/event-wait";
import type { SleepRow } from "../infra/db/types/sleep";
import type {
	StateTransitionRepository,
	StateTransitionRow,
	StateTransitionRowInsert,
} from "../infra/db/types/state-transition";
import type { TaskRow } from "../infra/db/types/task";
import type { WorkflowRepository, WorkflowRow } from "../infra/db/types/workflow";
import type { WorkflowRunRow } from "../infra/db/types/workflow-run";
import type { NamespaceRequestContext } from "../middleware/context";
import type { CancelledParentRun, ChildRunCanceller } from "../service/cancel-child-runs";
import { discardStaleTasks } from "../service/discard-stale-tasks";

export interface WorkflowRunServiceDeps {
	repos: Pick<
		Repositories,
		| "workflowRun"
		| "workflow"
		| "stateTransition"
		| "task"
		| "sleep"
		| "eventWait"
		| "childWorkflowRunWait"
		| "transaction"
	>;
	childRunCanceller: ChildRunCanceller;
	workflowRunStateMachine: WorkflowRunStateMachine;
}

export const createWorkflowRunService = ({
	repos,
	childRunCanceller,
	workflowRunStateMachine,
}: WorkflowRunServiceDeps) => ({
	async createWorkflowRun(
		context: NamespaceRequestContext,
		request: WorkflowRunCreateRequestV1
	): Promise<WorkflowRunId> {
		return repos.transaction(async (txRepos) => createWorkflowRunInTx(context, request, txRepos));
	},

	async getWorkflowRunById(context: NamespaceRequestContext, id: string): Promise<WorkflowRunRecord> {
		const { namespaceId } = context;

		const runRow = await repos.workflowRun.getById(namespaceId, id);
		if (!runRow) {
			throw new NotFoundError(`Workflow run not found: ${id}`);
		}

		const workflowRow = await repos.workflow.getById(namespaceId, runRow.workflowId);
		if (!workflowRow) {
			throw new NotFoundError(`Workflow not found for run: ${id}`);
		}

		return getWorkflowRun(repos, namespaceId, workflowRow, runRow);
	},

	async getWorkflowRunByReferenceId(
		context: NamespaceRequestContext,
		filter: WorkflowRunReference
	): Promise<WorkflowRunRecord> {
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

		return getWorkflowRun(repos, namespaceId, workflowRow, runRow);
	},

	async getWorkflowRunState(context: NamespaceRequestContext, id: string): Promise<WorkflowRunState> {
		const runRow = await repos.workflowRun.getById(context.namespaceId, id);
		if (!runRow) {
			throw new NotFoundError(`Workflow run not found: ${id}`);
		}

		const transition = await repos.stateTransition.getById(runRow.latestStateTransitionId);
		if (!transition) {
			throw new Error(`State transition not found: ${runRow.latestStateTransitionId}`);
		}
		return transition.state as WorkflowRunState;
	},

	async listWorkflowRuns(
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
				createdAt: row.createdAt,
				status: row.status,
				referenceId: row.referenceId ?? undefined,
				taskCounts: taskCountsByRunId.get(row.id),
			})),
			total,
		};
	},

	async listWorkflowRunTransitions(context: NamespaceRequestContext, request: WorkflowRunListTransitionsRequestV1) {
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
						createdAt: row.createdAt,
						attempt: row.attempt,
						taskId: row.taskId,
						taskState: row.state as TaskState,
					};
				}
				return {
					id: row.id,
					type: row.type satisfies "workflow_run",
					createdAt: row.createdAt,
					attempt: row.attempt,
					state: row.state as WorkflowRunState,
				};
			}),
			total,
		};
	},

	async sendEventToWorkflowRun(
		context: NamespaceRequestContext,
		runId: WorkflowRunId,
		eventName: string,
		data: unknown,
		reference: EventReference | undefined
	): Promise<void> {
		return repos.transaction(async (txRepos) => {
			// TODO: should we use getByIdWithState instead?
			// Con: extra join to get state is pointless if the run is not in awaiting_event state
			// Pro: If run is awaiting_event, no extra network call to fetch state
			const run = await txRepos.workflowRun.getById(context.namespaceId, runId);
			if (!run) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}

			const eventWaitEntry: EventWaitRowInsert = {
				id: ulid(),
				workflowRunId: runId,
				name: eventName,
				status: "received",
				referenceId: reference?.id,
				data,
			};
			if (propsRequiredNonNull(eventWaitEntry, "referenceId")) {
				await txRepos.eventWait.upsert(eventWaitEntry);
			} else {
				await txRepos.eventWait.insert(eventWaitEntry);
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
				await workflowRunStateMachine.transitionState(
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
	},

	async resolveRunIdsByReferences(
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
	},

	async listChildRuns(_context: NamespaceRequestContext, request: WorkflowRunListChildRunsRequestV1) {
		const childRuns = await repos.workflowRun.getChildRuns({
			parentRunId: request.parentRunId,
			status: isNonEmptyArray(request.status) ? request.status : undefined,
		});
		return {
			runs: childRuns.map((child) => {
				const pool = child.options?.pool;
				return {
					id: child.id,
					options: pool ? { pool } : undefined,
				};
			}),
		};
	},

	async cancelByIds({ namespaceId, logger }: NamespaceRequestContext, request: WorkflowRunCancelByIdsRequestV1) {
		const ids = request.ids;
		if (!isNonEmptyArray(ids)) {
			return { cancelledIds: [] };
		}

		return repos.transaction(async (txRepos) => {
			const cancelledRunIds = await txRepos.workflowRun.bulkTransitionToCancelled(namespaceId, ids);
			if (!isNonEmptyArray(cancelledRunIds)) {
				return { cancelledIds: [] };
			}

			await discardStaleTasks(cancelledRunIds, ["running", "awaiting_retry"], txRepos);
			await txRepos.sleep.bulkCancelByWorkflowRunIds(cancelledRunIds, Date.now() as TimestampMs);
			await txRepos.workflowRunOutbox.deleteByWorkflowRunIds(cancelledRunIds);

			const cancelledRuns = await txRepos.workflowRun.getByIds(namespaceId, cancelledRunIds);

			const cancelStateTransitionEntries: StateTransitionRowInsert[] = [];
			const cancelledRunStateTransitionUpdates: { id: string; stateTransitionId: string }[] = [];
			const cancelledRunsMeta: CancelledParentRun[] = [];

			for (const run of cancelledRuns) {
				const stateTransitionId = ulid();
				cancelStateTransitionEntries.push({
					id: stateTransitionId,
					workflowRunId: run.id,
					type: "workflow_run",
					status: "cancelled",
					attempt: run.attempts,
					state: { status: "cancelled", reason: "Cancelled" } satisfies WorkflowRunStateCancelled,
				});
				cancelledRunStateTransitionUpdates.push({ id: run.id, stateTransitionId });
				cancelledRunsMeta.push({
					namespaceId,
					runId: run.id,
					pool: run.options?.pool,
				});
			}

			if (isNonEmptyArray(cancelStateTransitionEntries) && isNonEmptyArray(cancelledRunStateTransitionUpdates)) {
				await txRepos.stateTransition.appendBatch(cancelStateTransitionEntries);
				await txRepos.workflowRun.bulkSetLatestStateTransitionId(cancelledRunStateTransitionUpdates);
			}

			if (isNonEmptyArray(cancelledRunsMeta)) {
				await childRunCanceller.cancel(cancelledRunsMeta, txRepos, logger);
			}

			return { cancelledIds: cancelledRunIds };
		});
	},

	async hasTerminated(context: NamespaceRequestContext, runId: string, afterStateTransitionId: string) {
		const result = await repos.stateTransition.hasTerminated(context.namespaceId, runId, afterStateTransitionId);
		if (!result.runFound) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		return {
			terminated: result.terminated,
			latestStateTransitionId: result.latestStateTransitionId,
		};
	},
});

export type WorkflowRunService = ReturnType<typeof createWorkflowRunService>;

async function createWorkflowRunInTx(
	{ namespaceId, logger }: NamespaceRequestContext,
	request: WorkflowRunCreateRequestV1,
	txRepos: Pick<Repositories, "workflowRun" | "workflow" | "stateTransition">
): Promise<WorkflowRunId> {
	const name = request.name as WorkflowName;
	const versionId = request.versionId as WorkflowVersionId;
	const parentWorkflowRunId = request.parentWorkflowRunId as WorkflowRunId | undefined;
	const { input, inputHash, options } = request;
	const referenceId = options?.reference?.id;

	const workflow = await txRepos.workflow.getOrCreate({ namespaceId, name, versionId, source: "user" });

	if (referenceId) {
		const existingRun = await txRepos.workflowRun.getByWorkflowAndReferenceId(workflow.id, referenceId);
		if (existingRun) {
			if (existingRun.inputHash !== inputHash) {
				const conflictPolicy = options?.reference?.conflictPolicy ?? "error";
				if (conflictPolicy === "error") {
					throw new WorkflowRunReferenceConflictError(name, versionId, referenceId);
				}
				conflictPolicy satisfies "return_existing";
			}

			logger.info("Returning existing run from reference ID", {
				"aiki.runId": existingRun.id,
				"aiki.referenceId": referenceId,
			});
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
		options: options && { retry: options.retry, pool: options.pool },
		referenceId,
		latestStateTransitionId: transitionId,
		scheduledAt: scheduledAt as TimestampMs,
	});

	const state: WorkflowRunStateScheduledByNew = {
		status: "scheduled",
		scheduledAt,
		reason: "new",
	};

	await txRepos.stateTransition.append({
		id: transitionId,
		workflowRunId: runId,
		type: "workflow_run",
		status: "scheduled",
		attempt: 1,
		state,
	});

	logger.info("Created workflow run", {
		"aiki.workflowName": name,
		"aiki.versionId": versionId,
		"aiki.runId": runId,
		"aiki.referenceId": referenceId,
		"aiki.options": options,
	});

	return runId;
}

async function getWorkflowRun(
	repos: WorkflowRunServiceDeps["repos"],
	namespaceId: NamespaceId,
	workflowRow: WorkflowRow,
	runRow: WorkflowRunRow
): Promise<WorkflowRunRecord> {
	const [latestTransition, taskRows, sleepRows, eventWaitRows, childRunRows, childWorkflowRunWaitRows] =
		await Promise.all([
			repos.stateTransition.getById(runRow.latestStateTransitionId),
			repos.task.listByWorkflowRunId(runRow.id),
			repos.sleep.listByWorkflowRunId(runRow.id as WorkflowRunId),
			repos.eventWait.listByWorkflowRunId(runRow.id),
			repos.workflowRun.getChildRuns({ parentRunId: runRow.id }),
			repos.childWorkflowRunWait.listByParentRunId(runRow.id),
		]);

	if (!latestTransition) {
		throw new Error(`State transition not found: ${runRow.latestStateTransitionId}`);
	}

	const taskTransitionIds = taskRows.map((task) => task.latestStateTransitionId);
	const taskTransitionRows = isNonEmptyArray(taskTransitionIds)
		? await repos.stateTransition.getByIds(taskTransitionIds)
		: [];
	const taskTransitionsById = new Map(taskTransitionRows.map((transition) => [transition.id, transition]));

	const tasksByAddress = buildTasksByAddress(taskRows, taskTransitionsById);
	const sleepsByName = buildSleepsByName(sleepRows);
	const eventWaitsByName = buildEventWaitsByName(eventWaitRows);
	const childWorkflowRunsByAddress = await buildChildWorkflowRunsByAddress(
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
		source: workflowRow.source,
		createdAt: runRow.createdAt,
		revision: runRow.revision,
		stateTransitionId: runRow.latestStateTransitionId,
		input: runRow.input,
		inputHash: runRow.inputHash,
		referenceId: runRow.referenceId ?? undefined,
		options: runRow.options !== null ? runRow.options : undefined,
		attempts: runRow.attempts,
		state: latestTransition.state as WorkflowRunState,
		tasks: tasksByAddress,
		sleeps: sleepsByName,
		eventWaits: eventWaitsByName,
		childWorkflowRuns: childWorkflowRunsByAddress,
		parentWorkflowRunId: runRow.parentWorkflowRunId ?? undefined,
		scheduleId: runRow.scheduleId ?? undefined,
	};
}

function buildTasksByAddress(
	tasks: TaskRow[],
	taskTransitionsById: Map<string, StateTransitionRow>
): Record<string, TaskInfo[]> {
	const tasksByAddress: Record<string, TaskInfo[]> = {};
	for (const task of tasks) {
		if (task.status === "discarded") {
			continue;
		}
		const address = getCompositeId({ name: task.name, referenceId: task.inputHash });
		const transition = taskTransitionsById.get(task.latestStateTransitionId);
		if (!transition) {
			throw new Error(`Task state transition not found: ${task.latestStateTransitionId}`);
		}
		const taskInfo: TaskInfo = {
			id: task.id,
			name: task.name,
			state: transition.state as Exclude<TaskState, TaskStateDiscarded>,
			inputHash: task.inputHash,
		};
		const tasksForAddress = tasksByAddress[address];
		if (tasksForAddress) {
			tasksForAddress.push(taskInfo);
		} else {
			tasksByAddress[address] = [taskInfo];
		}
	}
	return tasksByAddress;
}

function buildSleepsByName(sleepRows: SleepRow[]): Record<string, Sleep[]> {
	const sleepsByName: Record<string, Sleep[]> = {};

	for (const row of sleepRows) {
		let sleeps = sleepsByName[row.name];
		if (!sleeps) {
			sleeps = [];
			sleepsByName[row.name] = sleeps;
		}

		switch (row.status) {
			case "sleeping":
				sleeps.push({ status: row.status, wakeupAt: row.wakeupAt });
				break;
			case "completed": {
				const { completedAt } = row;
				if (completedAt === null) {
					throw Error(`Sleep ${row.id} completed but no completedAt timestamp`);
				}
				sleeps.push({
					status: row.status,
					durationMs: completedAt - row.createdAt,
					completedAt: completedAt,
				});
				break;
			}
			case "cancelled": {
				const { cancelledAt } = row;
				if (cancelledAt === null) {
					throw Error(`Sleep ${row.id} cancelled but no cancelledAt timestamp`);
				}
				sleeps.push({ status: row.status, cancelledAt: cancelledAt });
				break;
			}
			default:
				row.status satisfies never;
		}
	}

	return sleepsByName;
}

function buildEventWaitsByName(eventWaitRows: EventWaitRow[]): Record<string, EventWait<unknown>[]> {
	const eventWaitsByName: Record<string, EventWait<unknown>[]> = {};

	for (const row of eventWaitRows) {
		let eventWaits = eventWaitsByName[row.name];
		if (!eventWaits) {
			eventWaits = [];
			eventWaitsByName[row.name] = eventWaits;
		}

		switch (row.status) {
			case "received":
				eventWaits.push({
					status: row.status,
					data: row.data,
					receivedAt: row.createdAt,
					reference: row.referenceId ? { id: row.referenceId } : undefined,
				});
				break;
			case "timeout": {
				const { timedOutAt } = row;
				if (timedOutAt === null) {
					throw Error(`Event wait ${row.id} timed out but no timeoutAt timestamp`);
				}
				eventWaits.push({
					status: row.status,
					timedOutAt: timedOutAt,
				});
				break;
			}
			default:
				row.status satisfies never;
		}
	}

	return eventWaitsByName;
}

async function buildChildWorkflowRunsByAddress(
	namespaceId: NamespaceId,
	childRuns: WorkflowRunRow[],
	childRunWaits: ChildWorkflowRunWaitRow[],
	stateTransitionRepo: StateTransitionRepository,
	workflowRepo: WorkflowRepository
): Promise<Record<string, ChildWorkflowRunInfo[]>> {
	const childStateTransitionIds = childRunWaits.reduce((acc: string[], { childWorkflowRunStateTransitionId }) => {
		if (childWorkflowRunStateTransitionId !== null) {
			acc.push(childWorkflowRunStateTransitionId);
		}
		return acc;
	}, []);
	const childStateTransitions = isNonEmptyArray(childStateTransitionIds)
		? await stateTransitionRepo.getByIds(childStateTransitionIds)
		: [];
	const childStateTransitionsById = new Map(childStateTransitions.map((transition) => [transition.id, transition]));

	const waitsByChildRunId = new Map<WorkflowRunId, Record<TerminalWorkflowRunStatus, ChildWorkflowRunWait[]>>();

	for (const childRunWait of childRunWaits) {
		const childRunId = childRunWait.childWorkflowRunId as WorkflowRunId;

		let waits = waitsByChildRunId.get(childRunId);
		if (!waits) {
			waits = {
				cancelled: [],
				completed: [],
				failed: [],
			};
			waitsByChildRunId.set(childRunId, waits);
		}

		const { childWorkflowRunStatus } = childRunWait;

		switch (childRunWait.status) {
			case "completed": {
				const { completedAt, childWorkflowRunStateTransitionId } = childRunWait;
				if (completedAt === null) {
					throw new Error(`Child workflow run wait ${childRunWait.id} completed but no completedAt timestamp`);
				}
				if (childWorkflowRunStateTransitionId === null) {
					throw new Error(`Child workflow run wait ${childRunWait.id} completed but no state transition id`);
				}

				const childStateTransition = childStateTransitionsById.get(childWorkflowRunStateTransitionId);
				if (!childStateTransition) {
					throw new Error(`State transition not found: ${childWorkflowRunStateTransitionId}`);
				}

				waits[childWorkflowRunStatus].push({
					status: childRunWait.status,
					completedAt: completedAt,
					childWorkflowRunState: childStateTransition.state as TerminalWorkflowRunState,
				});
				break;
			}
			case "timeout": {
				const { timedOutAt } = childRunWait;
				if (timedOutAt === null) {
					throw new Error(`Child workflow run wait ${childRunWait.id} timed out but no timedOutAt timestamp`);
				}

				waits[childWorkflowRunStatus].push({
					status: childRunWait.status,
					timedOutAt: timedOutAt,
				});
				break;
			}
			default:
				childRunWait.status satisfies never;
		}
	}

	const childWorkflowIds = Array.from(new Set(childRuns.map((run) => run.workflowId)));
	const childWorkflows = isNonEmptyArray(childWorkflowIds)
		? await workflowRepo.getByIds(namespaceId, childWorkflowIds)
		: [];
	const childWorkflowsById = new Map(childWorkflows.map((workflow) => [workflow.id, workflow]));

	const childRunsByAddress: Record<string, ChildWorkflowRunInfo[]> = {};

	for (const childRun of childRuns) {
		const childWorkflow = childWorkflowsById.get(childRun.workflowId);
		if (!childWorkflow) {
			throw new Error(`Workflow not found for child run: ${childRun.id}`);
		}

		const childRunAddress = getCompositeId({
			name: childWorkflow.name,
			versionId: childWorkflow.versionId,
			referenceId: childRun.referenceId ?? childRun.inputHash,
		});

		const childRunInfo: ChildWorkflowRunInfo = {
			id: childRun.id,
			name: childWorkflow.name,
			versionId: childWorkflow.versionId,
			inputHash: childRun.inputHash,
			waits: waitsByChildRunId.get(childRun.id as WorkflowRunId) ?? {
				cancelled: [],
				completed: [],
				failed: [],
			},
		};

		const addressChildRuns = childRunsByAddress[childRunAddress];
		if (addressChildRuns) {
			addressChildRuns.push(childRunInfo);
		} else {
			childRunsByAddress[childRunAddress] = [childRunInfo];
		}
	}

	return childRunsByAddress;
}
