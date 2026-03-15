import { hashInput, isNonEmptyArray, stableStringify } from "@aikirun/lib";
import { sha256 } from "@aikirun/lib/crypto";
import type { NamespaceId } from "@aikirun/types/namespace";
import type {
	Schedule,
	ScheduleConflictPolicy,
	ScheduleId,
	ScheduleSpec,
	ScheduleStatus,
} from "@aikirun/types/schedule";
import type { ScheduleListRequestV1 } from "@aikirun/types/schedule-api";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import CronExpressionParser from "cron-parser";
import { NotFoundError, ScheduleConflictError } from "server/errors";
import type { DatabaseConn, DbTransaction } from "server/infra/db";
import type { ScheduleRepository, ScheduleRow } from "server/infra/db/repository/schedule";
import type { WorkflowRepository } from "server/infra/db/repository/workflow";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import type { Context } from "server/middleware/context";
import { ulid } from "ulidx";

export function getReferenceId(scheduleId: string, occurrence: number) {
	return `schedule:${scheduleId}:${occurrence}`;
}

/**
 * Computes all occurrences that are due between `anchor` and `now` (inclusive).
 * Used for catchup policy.
 */
function getAllOccurrencesBetween(spec: ScheduleSpec, anchor: number, now: number): number[] {
	const occurrences: number[] = [];

	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(anchor),
			tz: spec.timezone,
		});

		while (true) {
			const next = parsed.next().getTime();
			if (next > now) {
				break;
			}
			occurrences.push(next);
		}
	} else {
		let cursor = anchor + spec.everyMs;
		while (cursor <= now) {
			occurrences.push(cursor);
			cursor += spec.everyMs;
		}
	}

	return occurrences;
}

/**
 * Computes the last occurrence that should have fired before or at `now` timestamp,
 * but after the `anchor` timestamp. Returns undefined if no occurrence exists in that range.
 */
function getLastOccurrenceBetween(spec: ScheduleSpec, anchor: number, now: number): number | undefined {
	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(now),
			tz: spec.timezone,
		});
		const previous = parsed.prev().getTime();
		return previous > anchor ? previous : undefined;
	}

	const elapsed = now - anchor;
	if (elapsed < spec.everyMs) {
		return undefined;
	}
	const intervalsPassed = Math.floor(elapsed / spec.everyMs);
	return anchor + intervalsPassed * spec.everyMs;
}

export function getDueOccurrences(schedule: Schedule, now: number): number[] {
	const { spec } = schedule;
	const anchor = schedule.lastOccurrence ?? schedule.createdAt;
	const overlapPolicy = spec.overlapPolicy ?? "skip";

	if (overlapPolicy === "allow") {
		return getAllOccurrencesBetween(spec, anchor, now);
	}

	const lastDue = getLastOccurrenceBetween(spec, anchor, now);
	return lastDue !== undefined ? [lastDue] : [];
}

export function getNextOccurrence(spec: ScheduleSpec, anchor: number): number {
	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(anchor),
			tz: spec.timezone,
		});
		return parsed.next().getTime();
	}

	return anchor + spec.everyMs;
}

export interface ScheduleServiceDeps {
	db: DatabaseConn;
	scheduleRepo: ScheduleRepository;
	workflowRepo: WorkflowRepository;
	workflowRunRepo: WorkflowRunRepository;
}

export function createScheduleService(deps: ScheduleServiceDeps) {
	const { db, scheduleRepo, workflowRepo, workflowRunRepo } = deps;

	async function getDueSchedules(now: number) {
		const rows = await scheduleRepo.listDueSchedules(new Date(now));
		return rows.map(({ schedule, workflow }) => ({
			...scheduleRowToDomain(schedule, workflow),
			workflowId: schedule.workflowId,
			namespaceId: schedule.namespaceId as NamespaceId,
			workflowRunInputHash: schedule.workflowRunInputHash,
		}));
	}

	async function updateSchedule(
		namespaceId: NamespaceId,
		id: string,
		updates: Partial<{
			status: ScheduleStatus;
			lastOccurrence: Date | null;
			nextRunAt: Date | null;
		}>,
		tx?: DbTransaction
	): Promise<void> {
		const schedule = await scheduleRepo.update(namespaceId, id, updates, tx);
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	}

	async function activateSchedule(
		_context: Context,
		namespaceId: NamespaceId,
		request: {
			workflowName: string;
			workflowVersionId: string;
			input?: unknown;
			spec: ScheduleSpec;
			options?: { reference?: { id: string; conflictPolicy?: ScheduleConflictPolicy | null } };
		}
	): Promise<{ schedule: Schedule }> {
		const { workflowName, workflowVersionId, input, spec, options } = request;
		const definitionHash = await sha256(
			stableStringify({
				workflowName,
				workflowVersionId,
				spec,
				input,
			})
		);
		const referenceId = options?.reference?.id;
		const conflictPolicy = options?.reference?.conflictPolicy ?? "upsert";
		const workflowRunInputHash = await hashInput(input);

		return db.transaction(async (tx) => {
			const workflowRow = await workflowRepo.getOrCreate(
				namespaceId,
				workflowName as WorkflowName,
				workflowVersionId as WorkflowVersionId,
				tx
			);

			const workflowInfo = { workflowName, workflowVersionId };

			const existingSchedule = referenceId
				? await scheduleRepo.getByReferenceId(namespaceId, referenceId, tx)
				: await scheduleRepo.getByDefinitionHash(namespaceId, definitionHash, tx);

			if (existingSchedule) {
				if (existingSchedule.definitionHash === definitionHash && existingSchedule.status === "active") {
					return { schedule: scheduleRowToDomain(existingSchedule, workflowInfo) };
				}

				if (referenceId && existingSchedule.definitionHash !== definitionHash && conflictPolicy === "error") {
					throw new ScheduleConflictError(referenceId);
				}

				const now = Date.now();
				const updatedRow = await scheduleRepo.update(
					namespaceId,
					existingSchedule.id,
					{
						workflowId: workflowRow.id,
						status: "active",
						type: spec.type,
						cronExpression: spec.type === "cron" ? spec.expression : undefined,
						intervalMs: spec.type === "interval" ? spec.everyMs : undefined,
						overlapPolicy: spec.overlapPolicy,
						workflowRunInput: input,
						workflowRunInputHash,
						definitionHash,
						nextRunAt: new Date(getNextOccurrence(spec, now)),
					},
					tx
				);
				if (!updatedRow) {
					throw new NotFoundError(`Schedule not found: ${existingSchedule.id}`);
				}
				return { schedule: scheduleRowToDomain(updatedRow, workflowInfo) };
			}

			const id = ulid() as ScheduleId;
			const now = Date.now();
			const nextRunAt = getNextOccurrence(spec, now);

			const createdRow = await scheduleRepo.create(
				{
					id,
					namespaceId,
					workflowId: workflowRow.id,
					status: "active",
					type: spec.type,
					cronExpression: spec.type === "cron" ? spec.expression : null,
					intervalMs: spec.type === "interval" ? spec.everyMs : null,
					overlapPolicy: spec.overlapPolicy ?? null,
					workflowRunInput: input,
					workflowRunInputHash,
					definitionHash,
					referenceId,
					conflictPolicy: options?.reference?.conflictPolicy ?? null,
					nextRunAt: new Date(nextRunAt),
				},
				tx
			);
			return { schedule: scheduleRowToDomain(createdRow, workflowInfo) };
		});
	}

	async function getScheduleById(namespaceId: NamespaceId, id: string) {
		const result = await scheduleRepo.getByIdWithWorkflow(namespaceId, id);
		if (!result) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
		const runCount = await workflowRunRepo.getRunCount(result.schedule.id);
		return { schedule: scheduleRowToDomain(result.schedule, result.workflow), runCount };
	}

	async function getScheduleByReferenceId(namespaceId: NamespaceId, referenceId: string) {
		const result = await scheduleRepo.getByReferenceIdWithWorkflow(namespaceId, referenceId);
		if (!result) {
			throw new NotFoundError(`Schedule not found with referenceId: ${referenceId}`);
		}
		const runCount = await workflowRunRepo.getRunCount(result.schedule.id);
		return { schedule: scheduleRowToDomain(result.schedule, result.workflow), runCount };
	}

	async function listSchedules(
		namespaceId: NamespaceId,
		filters: ScheduleListRequestV1["filters"],
		limit: number,
		offset: number
	) {
		let workflowIds: string[] | undefined;
		if (isNonEmptyArray(filters?.workflows)) {
			const workflows = await workflowRepo.listByNameAndVersionPairs(namespaceId, filters.workflows);
			workflowIds = workflows.map((row) => row.id);
			if (workflowIds.length === 0) {
				return { schedules: [], total: 0 };
			}
		}

		const { rows: schedules, total } = await scheduleRepo.listByFilters(
			namespaceId,
			{
				id: filters?.id,
				referenceId: filters?.referenceId,
				status: filters?.status,
				workflowIds,
			},
			limit,
			offset
		);

		const scheduleIds = schedules.map((r) => r.schedule.id);
		if (!isNonEmptyArray(scheduleIds)) {
			return { schedules: [], total };
		}
		const runCountsByScheduleId = await workflowRunRepo.getRunCounts(scheduleIds);

		return {
			schedules: schedules.map(({ schedule, workflow }) => ({
				schedule: scheduleRowToDomain(schedule, workflow),
				runCount: runCountsByScheduleId.get(schedule.id) ?? 0,
			})),
			total,
		};
	}

	async function pauseSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		const schedule = await scheduleRepo.update(namespaceId, id, { status: "paused" });
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	}

	async function resumeSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		const schedule = await scheduleRepo.update(namespaceId, id, { status: "active" });
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	}

	async function deleteSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		const schedule = await scheduleRepo.update(namespaceId, id, { status: "deleted" });
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	}

	return {
		getDueSchedules: getDueSchedules,
		updateSchedule: updateSchedule,
		activateSchedule: activateSchedule,
		getScheduleById: getScheduleById,
		getScheduleByReferenceId: getScheduleByReferenceId,
		listSchedules: listSchedules,
		pauseSchedule: pauseSchedule,
		resumeSchedule: resumeSchedule,
		deleteSchedule: deleteSchedule,
	};
}

export type ScheduleService = ReturnType<typeof createScheduleService>;

export function scheduleRowToDomain(
	schedule: ScheduleRow,
	workflow: { workflowName: string; workflowVersionId: string }
): Schedule {
	const spec: ScheduleSpec =
		schedule.type === "cron"
			? {
					type: "cron",
					expression: schedule.cronExpression ?? "",
					overlapPolicy: schedule.overlapPolicy ?? undefined,
				}
			: {
					type: "interval",
					everyMs: schedule.intervalMs ?? 0,
					overlapPolicy: schedule.overlapPolicy ?? undefined,
				};

	return {
		id: schedule.id,
		workflowName: workflow.workflowName,
		workflowVersionId: workflow.workflowVersionId,
		status: schedule.status,
		spec,
		input: schedule.workflowRunInput,
		options: schedule.referenceId
			? { reference: { id: schedule.referenceId, conflictPolicy: schedule.conflictPolicy ?? undefined } }
			: undefined,
		createdAt: schedule.createdAt.getTime(),
		updatedAt: schedule.updatedAt.getTime(),
		lastOccurrence: schedule.lastOccurrence?.getTime(),
		nextRunAt: schedule.nextRunAt?.getTime() ?? 0,
	};
}
