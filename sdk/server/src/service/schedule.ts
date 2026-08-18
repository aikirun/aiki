import { isNonEmptyArray } from "@aikirun/lib/collection/array";
import { hashInput } from "@aikirun/lib/crypto";
import { NotFoundError } from "@aikirun/lib/error";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { ScheduleActivateRequestV1, ScheduleListRequestV1 } from "@aikirun/types/api/schedule";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { Schedule, ScheduleSpec, ScheduleStatus } from "@aikirun/types/schedule";
import type { WorkflowName, WorkflowSource, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunOptions } from "@aikirun/types/workflow/run";
import CronExpressionParser from "cron-parser";
import { ulid } from "ulidx";

import { ScheduleConflictError } from "../errors";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { ScheduleRow } from "../infra/db/types/schedule";

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
	repos: Repositories;
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
		namespaceId: NamespaceId,
		request: ScheduleActivateRequestV1
	): Promise<{ schedule: Schedule }> {
		const definition = await hashScheduleDefinitions(request);
		return repos.transaction(async (txRepos) => activateScheduleInTx(namespaceId, request, definition, txRepos));
	},

	async getScheduleById(namespaceId: NamespaceId, id: string) {
		const result = await repos.schedule.getByIdWithWorkflow(namespaceId, id);
		if (!result) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
		const runCount = await repos.workflowRun.getRunCount(namespaceId, result.schedule.id);
		return { schedule: scheduleRowToDomain(result.schedule, result.workflow), runCount };
	},

	async getScheduleByReferenceId(namespaceId: NamespaceId, referenceId: string) {
		const result = await repos.schedule.getByReferenceIdWithWorkflow(namespaceId, referenceId);
		if (!result) {
			throw new NotFoundError(`Schedule not found with referenceId: ${referenceId}`);
		}
		const runCount = await repos.workflowRun.getRunCount(namespaceId, result.schedule.id);
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
		const runCountsByScheduleId = await repos.workflowRun.getRunCounts(namespaceId, scheduleIds);

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

	async deactivateSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		const schedule = await repos.schedule.update(namespaceId, { id }, { status: "inactive" });
		if (!schedule) {
			throw new NotFoundError(`Schedule not found: ${id}`);
		}
	},
});

export type ScheduleService = ReturnType<typeof createScheduleService>;

async function hashScheduleDefinitions(request: ScheduleActivateRequestV1): Promise<{
	currentHash: string;
	candidateHashes: string[];
}> {
	const { workflowName, workflowVersionId, workflowRunInputHash, workflowRunOptions, spec } = request;
	const hashDefinition = (inputHash: string) =>
		// insecure hashing is safe here as workflowRunInputHash already has keyed hashing
		hashInput({
			workflowName,
			workflowVersionId,
			spec,
			workflowRunInputHash: inputHash,
			workflowRunOptions,
		});

	const [currentHash, ...deprecatedHashes] = await Promise.all([
		hashDefinition(workflowRunInputHash.value),
		...(workflowRunInputHash.deprecatedValues ?? []).map(hashDefinition),
	]);

	return { currentHash, candidateHashes: Array.from(new Set([currentHash].concat(deprecatedHashes))) };
}

async function activateScheduleInTx(
	namespaceId: NamespaceId,
	request: ScheduleActivateRequestV1,
	definition: { currentHash: string; candidateHashes: string[] },
	txRepos: TxRepositories
) {
	const { workflowName, workflowVersionId, workflowRunInput, workflowRunInputHash, workflowRunOptions, spec, options } =
		request;
	const definitionHash = definition.currentHash;
	const workflowRunInputHashValue = workflowRunInputHash.value;

	const referenceId = options?.reference?.id;
	const conflictPolicy = options?.reference?.conflictPolicy ?? "error";

	const workflowRow = await txRepos.workflow.getOrCreate({
		namespaceId,
		name: workflowName as WorkflowName,
		versionId: workflowVersionId as WorkflowVersionId,
		source: "user",
	});

	const workflowInfo = { workflowSource: workflowRow.source, workflowName, workflowVersionId };
	const now = Date.now();
	const nextRunAt = getNextOccurrence(spec, now) as TimestampMs;

	if (!referenceId) {
		const existingScheduleByDefinition = await txRepos.schedule.get(namespaceId, {
			definitionHashes: definition.candidateHashes,
		});

		const schedule = existingScheduleByDefinition
			? await reuseSchedule(txRepos.schedule, {
					namespaceId,
					existing: existingScheduleByDefinition,
					workflowRunInputHash: workflowRunInputHashValue,
					definitionHash,
					nextRunAt,
				})
			: await createSchedule(txRepos.schedule, {
					namespaceId,
					workflowId: workflowRow.id,
					spec,
					workflowRunInput,
					workflowRunInputHash: workflowRunInputHashValue,
					definitionHash,
					referenceId: undefined,
					workflowRunOptions,
					nextRunAt,
				});

		return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
	}

	const existingScheduleByReference = await txRepos.schedule.get(namespaceId, { referenceId });
	if (existingScheduleByReference) {
		if (!definition.candidateHashes.includes(existingScheduleByReference.definitionHash)) {
			if (conflictPolicy === "error") {
				throw new ScheduleConflictError({ definitionHash, referenceId });
			}
			conflictPolicy satisfies "return_existing";
			return { schedule: scheduleRowToDomain(existingScheduleByReference, workflowInfo) };
		}

		const schedule = await reuseSchedule(txRepos.schedule, {
			namespaceId,
			existing: existingScheduleByReference,
			workflowRunInputHash: workflowRunInputHashValue,
			definitionHash,
			nextRunAt,
		});

		return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
	}

	// Reference id is free, but the definition may already exist.
	const existingNonReferencedSchedule = await txRepos.schedule.get(namespaceId, {
		definitionHashes: definition.candidateHashes,
		referenceId: null,
	});

	if (existingNonReferencedSchedule) {
		const schedule = await txRepos.schedule.update(
			namespaceId,
			{ id: existingNonReferencedSchedule.id, referenceId: null },
			{
				referenceId,
				status: "active",
				nextRunAt,
				workflowRunInputHash: workflowRunInputHashValue,
				definitionHash,
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
		workflowRunInput,
		workflowRunInputHash: workflowRunInputHashValue,
		definitionHash,
		referenceId,
		workflowRunOptions,
		nextRunAt,
	});

	return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
}

async function reuseSchedule(
	repo: Repositories["schedule"],
	params: {
		namespaceId: NamespaceId;
		existing: ScheduleRow;
		workflowRunInputHash: string;
		definitionHash: string;
		nextRunAt: TimestampMs;
	}
): Promise<ScheduleRow> {
	const needsActivation = params.existing.status !== "active";
	const hashesChanged =
		params.existing.workflowRunInputHash !== params.workflowRunInputHash ||
		params.existing.definitionHash !== params.definitionHash;

	if (!needsActivation && !hashesChanged) {
		return params.existing;
	}

	const updates: {
		status?: "active";
		nextRunAt?: TimestampMs;
		workflowRunInputHash?: string;
		definitionHash?: string;
	} = {};

	if (needsActivation) {
		updates.status = "active";
		updates.nextRunAt = params.nextRunAt;
	}

	if (hashesChanged) {
		updates.workflowRunInputHash = params.workflowRunInputHash;
		updates.definitionHash = params.definitionHash;
	}

	const updatedRow = await repo.update(params.namespaceId, { id: params.existing.id }, updates);

	if (!updatedRow) {
		throw new NotFoundError(`Schedule not found: ${params.existing.id}`);
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
		workflowRunOptions: WorkflowRunOptions | undefined;
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
		cronTimezone: spec.type === "cron" ? (spec.timezone ?? null) : null,
		intervalMs: spec.type === "interval" ? spec.everyMs : null,
		overlapPolicy: spec.overlapPolicy ?? null,
		workflowRunInput: params.workflowRunInput,
		workflowRunInputHash: params.workflowRunInputHash,
		definitionHash: params.definitionHash,
		referenceId: params.referenceId,
		workflowRunOptions: params.workflowRunOptions,
		nextRunAt: params.nextRunAt,
	});
}

export function scheduleRowToDomain(
	schedule: ScheduleRow,
	workflow: { workflowSource: WorkflowSource; workflowName: string; workflowVersionId: string }
): Schedule {
	const spec = toScheduleSpec(schedule);

	return {
		id: schedule.id,
		workflowSource: workflow.workflowSource,
		workflowName: workflow.workflowName,
		workflowVersionId: workflow.workflowVersionId,
		status: schedule.status,
		spec,
		workflowRunInput: schedule.workflowRunInput,
		referenceId: schedule.referenceId ?? undefined,
		workflowRunOptions: schedule.workflowRunOptions ?? undefined,
		createdAt: schedule.createdAt,
		updatedAt: schedule.updatedAt,
		lastOccurrence: schedule.lastOccurrence ?? undefined,
		nextRunAt: schedule.nextRunAt ?? 0,
	};
}

function toScheduleSpec(schedule: ScheduleRow): ScheduleSpec {
	const overlapPolicy = schedule.overlapPolicy ?? undefined;

	if (schedule.type === "cron") {
		if (schedule.cronExpression === null) {
			throw new Error(`Cron schedule has no expression: ${schedule.id}`);
		}
		return {
			type: "cron",
			expression: schedule.cronExpression,
			timezone: schedule.cronTimezone ?? undefined,
			overlapPolicy,
		};
	}

	schedule.type satisfies "interval";

	if (schedule.intervalMs === null) {
		throw new Error(`Interval schedule has no interval: ${schedule.id}`);
	}
	return { type: "interval", everyMs: schedule.intervalMs, overlapPolicy };
}
