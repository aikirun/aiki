import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
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
import type { EventWaitRow, EventWaitRowInsert } from "../infra/db/types/event-wait";
import type { SleepRow } from "../infra/db/types/sleep";
import type { StateTransitionRowInsert } from "../infra/db/types/state-transition";
import type { NamespaceRequestContext } from "../middleware/context";
import type { CancelledRunMeta, ChildRunCanceller } from "../service/cancel-child-runs";
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

		const result = await repos.workflowRun.getByIdWithWorkflowAndState({ namespaceId, id });
		if (!result) {
			throw new NotFoundError(`Workflow run not found: ${id}`);
		}

		return getWorkflowRun(repos, namespaceId, result);
	},

	async getWorkflowRunByReferenceId(
		context: NamespaceRequestContext,
		filter: WorkflowRunReference
	): Promise<WorkflowRunRecord> {
		const { namespaceId } = context;
		const { name, versionId, referenceId } = filter;

		const result = await repos.workflowRun.getByReferenceWithWorkflowAndState({
			namespaceId,
			name,
			versionId,
			source: "user",
			referenceId,
		});
		if (!result) {
			throw new NotFoundError(`Workflow run ${name}:${versionId} not found for reference: ${referenceId}`);
		}

		return getWorkflowRun(repos, namespaceId, result);
	},

	async getWorkflowRunState(context: NamespaceRequestContext, id: string): Promise<WorkflowRunState> {
		const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id });
		if (!run) {
			throw new NotFoundError(`Workflow run not found: ${id}`);
		}
		return run.state;
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
						{
							namespaceId,
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
					{
						namespaceId,
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
			? await repos.task.countByWorkflowRunIds(runIds)
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
			const result = await txRepos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			if (!result) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}
			const { run, state } = result;

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

			if (state.status === "awaiting_event" && state.eventName === eventName) {
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
			return { namespaceId, workflowId: workflow.id, referenceId };
		});
		if (!isNonEmptyArray(workflowIdAndReferenceIdPairs)) {
			return [];
		}

		const runs = await repos.workflowRun.listByWorkflowAndReferenceIdPairs({ pairs: workflowIdAndReferenceIdPairs });
		const runsByKey = new Map(
			runs.reduce<[string, { id: string }][]>((acc, run) => {
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

	async listChildRuns(context: NamespaceRequestContext, request: WorkflowRunListChildRunsRequestV1) {
		const childRuns = await repos.workflowRun.getChildRuns({
			namespaceId: context.namespaceId,
			id: request.id,
			childRunStatus: isNonEmptyArray(request.childRunStatus) ? request.childRunStatus : undefined,
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
			const cancelledRuns = await txRepos.workflowRun.bulkTransitionToCancelledInNamespace(namespaceId, ids);
			if (!isNonEmptyArray(cancelledRuns)) {
				return { cancelledIds: [] };
			}
			const cancelledRunIds = cancelledRuns.map((run) => run.id) as NonEmptyArray<string>;

			await discardStaleTasks(cancelledRunIds, ["running", "awaiting_retry"], txRepos);
			await txRepos.sleep.bulkCancelByWorkflowRunIds(cancelledRunIds, Date.now() as TimestampMs);
			await txRepos.workflowRunOutbox.deleteByWorkflowRunIds(cancelledRunIds);

			const cancelStateTransitionEntries: StateTransitionRowInsert[] = [];
			const cancelledRunStateTransitionUpdates: {
				filter: { namespaceId: NamespaceId; id: string };
				update: { stateTransitionId: string };
			}[] = [];
			const cancelledRunsMeta: CancelledRunMeta[] = [];

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
				cancelledRunStateTransitionUpdates.push({ filter: { namespaceId, id: run.id }, update: { stateTransitionId } });
				cancelledRunsMeta.push({
					namespaceId,
					id: run.id,
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
		const existingRun = await txRepos.workflowRun.getByWorkflowAndReferenceId({
			namespaceId,
			workflowId: workflow.id,
			referenceId,
		});
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

type WorkflowRunWithWorkflowAndState = NonNullable<
	Awaited<ReturnType<Repositories["workflowRun"]["getByIdWithWorkflowAndState"]>>
>;

async function getWorkflowRun(
	repos: WorkflowRunServiceDeps["repos"],
	namespaceId: NamespaceId,
	{ run, workflow, state }: WorkflowRunWithWorkflowAndState
): Promise<WorkflowRunRecord> {
	const [taskRows, sleepRows, eventWaitRows, childRunRows, childWorkflowRunWaitRows] = await Promise.all([
		repos.task.listByWorkflowRunIdWithState(run.id),
		repos.sleep.listByWorkflowRunId(run.id as WorkflowRunId),
		repos.eventWait.listByWorkflowRunId(run.id),
		repos.workflowRun.getChildRunsWithWorkflow({ namespaceId, id: run.id }),
		repos.childWorkflowRunWait.listByParentRunIdWithChildState(run.id),
	]);

	return {
		id: run.id,
		name: workflow.name,
		versionId: workflow.versionId,
		source: workflow.source,
		createdAt: run.createdAt,
		revision: run.revision,
		stateTransitionId: run.latestStateTransitionId,
		input: run.input,
		inputHash: run.inputHash,
		referenceId: run.referenceId ?? undefined,
		options: run.options !== null ? run.options : undefined,
		attempts: run.attempts,
		state,
		tasks: buildTasksByAddress(taskRows),
		sleeps: buildSleepsByName(sleepRows),
		eventWaits: buildEventWaitsByName(eventWaitRows),
		childWorkflowRuns: buildChildWorkflowRunsByAddress(childRunRows, childWorkflowRunWaitRows),
		parentWorkflowRunId: run.parentWorkflowRunId ?? undefined,
		scheduleId: run.scheduleId ?? undefined,
	};
}

function buildTasksByAddress(
	tasks: Array<{
		id: string;
		name: string;
		inputHash: string;
		state: TaskState;
	}>
): Record<string, TaskInfo[]> {
	const tasksByAddress: Record<string, TaskInfo[]> = {};
	for (const task of tasks) {
		const address = getCompositeId({ name: task.name, referenceId: task.inputHash });
		const taskInfo: TaskInfo = {
			id: task.id,
			name: task.name,
			state: task.state as Exclude<TaskState, TaskStateDiscarded>,
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

function buildChildWorkflowRunsByAddress(
	childRuns: Awaited<ReturnType<Repositories["workflowRun"]["getChildRunsWithWorkflow"]>>,
	childRunWaits: Awaited<ReturnType<Repositories["childWorkflowRunWait"]["listByParentRunIdWithChildState"]>>
): Record<string, ChildWorkflowRunInfo[]> {
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
				const { completedAt, childWorkflowRunState } = childRunWait;
				if (completedAt === null) {
					throw new Error(`Child workflow run wait ${childRunWait.id} completed but no completedAt timestamp`);
				}
				if (childWorkflowRunState === null) {
					throw new Error(`Child workflow run wait ${childRunWait.id} completed but no child run state`);
				}

				waits[childWorkflowRunStatus].push({
					status: childRunWait.status,
					completedAt: completedAt,
					childWorkflowRunState: childWorkflowRunState as TerminalWorkflowRunState,
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

	const childRunsByAddress: Record<string, ChildWorkflowRunInfo[]> = {};

	for (const { run: childRun, workflow: childWorkflow } of childRuns) {
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
