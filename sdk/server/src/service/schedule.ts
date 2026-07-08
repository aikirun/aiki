import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import { hashInput, sha256Async } from "@aikirun/lib/crypto";
import { NotFoundError } from "@aikirun/lib/error";
import { stableStringify } from "@aikirun/lib/json";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { ScheduleListRequestV1 } from "@aikirun/types/api/schedule";
import type { NamespaceId } from "@aikirun/types/namespace";
import type {
	Schedule,
	ScheduleConflictPolicy,
	ScheduleId,
	ScheduleSpec,
	ScheduleStatus,
} from "@aikirun/types/schedule";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import CronExpressionParser from "cron-parser";
import { ulid } from "ulidx";

import { ScheduleConflictError } from "../errors";
import type { Repositories } from "../infra/db/types";
import type { ScheduleRow } from "../infra/db/types/schedule";
import type { Context } from "../middleware/context";

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
	repos: Pick<Repositories, "schedule" | "workflow" | "workflowRun" | "transaction">;
}

export const createScheduleService = ({ repos }: ScheduleServiceDeps) => ({
	async updateSchedule(
		namespaceId: NamespaceId,
		id: string,
		updates: Partial<{
			status: ScheduleStatus;
			lastOccurrence: TimestampMs | null;
			nextRunAt: TimestampMs | null;
		}>
	): Promise<void> {
		const schedule = await repos.schedule.update(namespaceId, { id }, updates);
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	},

	async activateSchedule(
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
		const definitionHash = await sha256Async(
			stableStringify({
				workflowName,
				workflowVersionId,
				spec,
				input,
			})
		);
		const referenceId = options?.reference?.id;
		const conflictPolicy = options?.reference?.conflictPolicy ?? "error";
		const workflowRunInputHash = await hashInput(input);

		return repos.transaction(async (txRepos) => {
			const workflowRow = await txRepos.workflow.getOrCreate({
				namespaceId,
				name: workflowName as WorkflowName,
				versionId: workflowVersionId as WorkflowVersionId,
				source: "user",
			});

			const workflowInfo = { workflowName, workflowVersionId };
			const now = Date.now();
			const nextRunAt = getNextOccurrence(spec, now) as TimestampMs;

			if (!referenceId) {
				const existingScheduleByDefinition = await txRepos.schedule.get(namespaceId, { definitionHash });

				const schedule = existingScheduleByDefinition
					? existingScheduleByDefinition.status === "active"
						? existingScheduleByDefinition
						: await reactivateSchedule(txRepos.schedule, {
								namespaceId,
								scheduleId: existingScheduleByDefinition.id as ScheduleId,
								nextRunAt,
							})
					: await createSchedule(txRepos.schedule, {
							namespaceId,
							workflowId: workflowRow.id,
							spec,
							workflowRunInput: input,
							workflowRunInputHash,
							definitionHash,
							referenceId: undefined,
							conflictPolicy: options?.reference?.conflictPolicy,
							nextRunAt,
						});

				return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
			}

			const existingScheduleByReference = await txRepos.schedule.get(namespaceId, { referenceId });
			if (existingScheduleByReference) {
				if (existingScheduleByReference.definitionHash !== definitionHash) {
					if (conflictPolicy === "error") {
						throw new ScheduleConflictError({ definitionHash, referenceId });
					}
					conflictPolicy satisfies "return_existing";
					return { schedule: scheduleRowToDomain(existingScheduleByReference, workflowInfo) };
				}

				const schedule =
					existingScheduleByReference.status === "active"
						? existingScheduleByReference
						: await reactivateSchedule(txRepos.schedule, {
								namespaceId,
								scheduleId: existingScheduleByReference.id as ScheduleId,
								nextRunAt,
							});

				return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
			}

			// Reference id is free, but the definition may already exist.
			const existingNonReferencedSchedule = await txRepos.schedule.get(namespaceId, {
				definitionHash,
				referenceId: null,
			});
			if (existingNonReferencedSchedule) {
				const schedule = await txRepos.schedule.update(
					namespaceId,
					{ id: existingNonReferencedSchedule.id, referenceId: null },
					{
						referenceId,
						conflictPolicy: options?.reference?.conflictPolicy ?? null,
						status: "active",
						nextRunAt,
					}
				);
				if (schedule) {
					return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
				}
			}

			const schedule = await createSchedule(txRepos.schedule, {
				namespaceId,
				workflowId: workflowRow.id,
				spec,
				workflowRunInput: input,
				workflowRunInputHash,
				definitionHash,
				referenceId,
				conflictPolicy: options?.reference?.conflictPolicy,
				nextRunAt,
			});
			return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
		});
	},

	async getScheduleById(namespaceId: NamespaceId, id: string) {
		const result = await repos.schedule.getByIdWithWorkflow(namespaceId, id);
		if (!result) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
		const runCount = await repos.workflowRun.getRunCount(result.schedule.id);
		return { schedule: scheduleRowToDomain(result.schedule, result.workflow), runCount };
	},

	async getScheduleByReferenceId(namespaceId: NamespaceId, referenceId: string) {
		const result = await repos.schedule.getByReferenceIdWithWorkflow(namespaceId, referenceId);
		if (!result) {
			throw new NotFoundError(`Schedule not found with referenceId: ${referenceId}`);
		}
		const runCount = await repos.workflowRun.getRunCount(result.schedule.id);
		return { schedule: scheduleRowToDomain(result.schedule, result.workflow), runCount };
	},

	async listSchedules(
		namespaceId: NamespaceId,
		filters: ScheduleListRequestV1["filters"],
		limit: number,
		offset: number
	) {
		let workflowIds: string[] | undefined;
		if (isNonEmptyArray(filters?.workflows)) {
			const workflows = await repos.workflow.listByNameAndVersionPairs(namespaceId, filters.workflows);
			workflowIds = workflows.map((row) => row.id);
			if (workflowIds.length === 0) {
				return { schedules: [], total: 0 };
			}
		}

		const { rows: schedules, total } = await repos.schedule.listByFilters(
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
		const runCountsByScheduleId = await repos.workflowRun.getRunCounts(scheduleIds);

		return {
			schedules: schedules.map(({ schedule, workflow }) => ({
				schedule: scheduleRowToDomain(schedule, workflow),
				runCount: runCountsByScheduleId.get(schedule.id) ?? 0,
			})),
			total,
		};
	},

	async pauseSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		const schedule = await repos.schedule.update(namespaceId, { id }, { status: "paused" });
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	},

	async resumeSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		const schedule = await repos.schedule.update(namespaceId, { id }, { status: "active" });
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	},

	async deleteSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		const schedule = await repos.schedule.update(namespaceId, { id }, { status: "deleted" });
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	},
});

export type ScheduleService = ReturnType<typeof createScheduleService>;

async function reactivateSchedule(
	repo: Repositories["schedule"],
	params: { namespaceId: NamespaceId; scheduleId: ScheduleId; nextRunAt: TimestampMs }
): Promise<ScheduleRow> {
	const updatedRow = await repo.update(
		params.namespaceId,
		{ id: params.scheduleId },
		{
			status: "active",
			nextRunAt: params.nextRunAt,
		}
	);
	if (!updatedRow) {
		throw new NotFoundError(`Schedule not found: ${params.scheduleId}`);
	}
	return updatedRow;
}

async function createSchedule(
	repo: Repositories["schedule"],
	params: {
		namespaceId: NamespaceId;
		workflowId: string;
		spec: ScheduleSpec;
		workflowRunInput: unknown;
		workflowRunInputHash: string;
		definitionHash: string;
		referenceId: string | undefined;
		conflictPolicy: ScheduleConflictPolicy | undefined | null;
		nextRunAt: TimestampMs;
	}
): Promise<ScheduleRow> {
	const { spec } = params;
	return repo.create({
		id: ulid(),
		namespaceId: params.namespaceId,
		workflowId: params.workflowId,
		status: "active",
		type: spec.type,
		cronExpression: spec.type === "cron" ? spec.expression : null,
		intervalMs: spec.type === "interval" ? spec.everyMs : null,
		overlapPolicy: spec.overlapPolicy ?? null,
		workflowRunInput: params.workflowRunInput,
		workflowRunInputHash: params.workflowRunInputHash,
		definitionHash: params.definitionHash,
		referenceId: params.referenceId,
		conflictPolicy: params.conflictPolicy,
		nextRunAt: params.nextRunAt,
	});
}

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
		createdAt: schedule.createdAt,
		updatedAt: schedule.updatedAt,
		lastOccurrence: schedule.lastOccurrence ?? undefined,
		nextRunAt: schedule.nextRunAt ?? 0,
	};
}
