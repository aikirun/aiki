import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import { hashInput } from "@aikirun/lib/crypto";
import { NotFoundError } from "@aikirun/lib/error";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { ScheduleActivateRequestV1, ScheduleListRequestV1 } from "@aikirun/types/api/schedule";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OpaquePayload } from "@aikirun/types/payload";
import type { Schedule, ScheduleSpec, ScheduleStatus } from "@aikirun/types/schedule";
import type { WorkflowName, WorkflowSource, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunOptions } from "@aikirun/types/workflow/run";
import CronExpressionParser from "cron-parser";
import { ulid } from "ulidx";

import { getOrCreateWorkflowInTx } from "./workflow";
import { ScheduleConflictError } from "../errors";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { ScheduleRow } from "../infra/db/types/schedule";

export function getReferenceId(scheduleId: string, occurrence: number) {
	return `schedule:${scheduleId}:${occurrence}`;
}

export interface DueOccurrences {
	/** Occurrences due at or before `now`, oldest first. */
	occurrences: NonEmptyArray<number>;
	/** The occurrence after the last due one. */
	nextRunAt: number;
}

/**
 * Returns every occurrence due between `anchor` and `now` (inclusive).
 * Also returns the first non-due occurrence i.e. `nextRunAt`.
 * Used for the allow policy.
 */
function getAllDueOccurrencesBetween(spec: ScheduleSpec, anchor: number, now: number): DueOccurrences | null {
	const occurrences: number[] = [];
	let nextRunAt: number;

	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(anchor),
			tz: spec.timezone,
		});

		let next = parsed.next().getTime();
		while (next <= now) {
			occurrences.push(next);
			next = parsed.next().getTime();
		}
		nextRunAt = next;
	} else {
		let cursor = anchor + spec.everyMs;
		while (cursor <= now) {
			occurrences.push(cursor);
			cursor += spec.everyMs;
		}
		nextRunAt = cursor;
	}

	if (!isNonEmptyArray(occurrences)) {
		return null;
	}
	return { occurrences, nextRunAt };
}

/**
 * Returns the last occurrence due between `anchor` and `now` (inclusive).
 * Also returns the first non-due occurrence i.e. `nextRunAt`.
 * Used for the skip and cancel_previous policies.
 */
function getLastDueOccurrenceBetween(spec: ScheduleSpec, anchor: number, now: number): DueOccurrences | null {
	if (spec.type === "cron") {
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(now),
			tz: spec.timezone,
		});
		const previous = parsed.prev().getTime();
		if (previous <= anchor) {
			return null;
		}
		// The parser's cursor now sits on `previous`, so next() is the occurrence after it.
		return { occurrences: [previous], nextRunAt: parsed.next().getTime() };
	}

	const elapsed = now - anchor;
	if (elapsed < spec.everyMs) {
		return null;
	}
	const intervalsPassed = Math.floor(elapsed / spec.everyMs);
	const last = anchor + intervalsPassed * spec.everyMs;
	return { occurrences: [last], nextRunAt: last + spec.everyMs };
}

/**
 * What a schedule owes as of `now`, and when it runs next.
 * Returns null when nothing is due.
 */
export function getDueOccurrences(
	schedule: Pick<Schedule, "spec" | "lastOccurrence" | "createdAt">,
	now: number
): DueOccurrences | null {
	const { spec } = schedule;
	const anchor = schedule.lastOccurrence ?? schedule.createdAt;
	const overlapPolicy = spec.overlapPolicy ?? "skip";

	if (overlapPolicy === "allow") {
		return getAllDueOccurrencesBetween(spec, anchor, now);
	}
	return getLastDueOccurrenceBetween(spec, anchor, now);
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

interface SchedulePayload {
	workflowRunInput: OpaquePayload | null;
	workflowRunInputHash: string;
	clientCodecApplied: boolean;
	definitionHash: string;
}

async function activateScheduleInTx(
	namespaceId: NamespaceId,
	request: ScheduleActivateRequestV1,
	definition: { currentHash: string; candidateHashes: string[] },
	txRepos: TxRepositories
) {
	const { workflowName, workflowVersionId, workflowRunOptions, spec, options } = request;
	// The activating client computed these together, with its own codec and keys, so they are
	// always stored together: a row mixing one client's input with another's hash or declaration
	// would mint runs whose input does not decode.
	const payload: SchedulePayload = {
		workflowRunInput: request.workflowRunInput ?? null,
		workflowRunInputHash: request.workflowRunInputHash.value,
		clientCodecApplied: request.clientCodecApplied,
		definitionHash: definition.currentHash,
	};

	const referenceId = options?.reference?.id;
	const conflictPolicy = options?.reference?.conflictPolicy ?? "error";

	const workflowRow = await getOrCreateWorkflowInTx(
		{
			namespaceId,
			name: workflowName as WorkflowName,
			versionId: workflowVersionId as WorkflowVersionId,
			source: "user",
		},
		txRepos
	);

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
					payload,
					nextRunAt,
				})
			: await createSchedule(txRepos.schedule, {
					namespaceId,
					workflowId: workflowRow.id,
					spec,
					payload,
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
				throw new ScheduleConflictError({ definitionHash: payload.definitionHash, referenceId });
			}
			conflictPolicy satisfies "return_existing";
			return { schedule: scheduleRowToDomain(existingScheduleByReference, workflowInfo) };
		}

		const schedule = await reuseSchedule(txRepos.schedule, {
			namespaceId,
			existing: existingScheduleByReference,
			payload,
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
				workflowRunInput: payload.workflowRunInput,
				workflowRunInputHash: payload.workflowRunInputHash,
				clientCodecApplied: payload.clientCodecApplied,
				definitionHash: payload.definitionHash,
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
		payload,
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
		payload: SchedulePayload;
		nextRunAt: TimestampMs;
	}
): Promise<ScheduleRow> {
	const { existing, payload } = params;
	const needsActivation = existing.status !== "active";
	// The stored input itself is not compared: a codec may encode the same input differently
	// each time, and an unchanged hash and declaration mean the stored value still decodes.
	const payloadChanged =
		existing.workflowRunInputHash !== payload.workflowRunInputHash ||
		existing.definitionHash !== payload.definitionHash ||
		existing.clientCodecApplied !== payload.clientCodecApplied;

	if (!needsActivation && !payloadChanged) {
		return existing;
	}

	const updates: Partial<SchedulePayload> & { status?: "active"; nextRunAt?: TimestampMs } = {};

	if (needsActivation) {
		updates.status = "active";
		updates.nextRunAt = params.nextRunAt;
	}

	if (payloadChanged) {
		updates.workflowRunInput = payload.workflowRunInput;
		updates.workflowRunInputHash = payload.workflowRunInputHash;
		updates.clientCodecApplied = payload.clientCodecApplied;
		updates.definitionHash = payload.definitionHash;
	}

	const updatedRow = await repo.update(params.namespaceId, { id: existing.id }, updates);

	if (!updatedRow) {
		throw new NotFoundError(`Schedule not found: ${existing.id}`);
	}

	return updatedRow;
}

async function createSchedule(
	repo: Repositories["schedule"],
	params: {
		namespaceId: NamespaceId;
		workflowId: string;
		spec: ScheduleSpec;
		payload: SchedulePayload;
		referenceId: string | undefined;
		workflowRunOptions: WorkflowRunOptions | undefined;
		nextRunAt: TimestampMs;
	}
): Promise<ScheduleRow> {
	const { spec, payload } = params;
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
		workflowRunInput: payload.workflowRunInput,
		workflowRunInputHash: payload.workflowRunInputHash,
		clientCodecApplied: payload.clientCodecApplied,
		definitionHash: payload.definitionHash,
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
		workflowRunInput: schedule.workflowRunInput ?? undefined,
		clientCodecApplied: schedule.clientCodecApplied,
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
