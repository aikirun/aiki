import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import { hashInput } from "@aikirun/lib/crypto";
import { NotFoundError } from "@aikirun/lib/error";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { ScheduleActivateRequestV1, ScheduleListRequestV1 } from "@aikirun/types/api/schedule";
import type { Hash } from "@aikirun/types/infra/hasher";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OpaquePayload } from "@aikirun/types/payload";
import type { Schedule, ScheduleSpec } from "@aikirun/types/schedule";
import type { WorkflowName, WorkflowSource, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunOptions } from "@aikirun/types/workflow/run";
import CronExpressionParser from "cron-parser";
import { ulid } from "ulidx";

import { getOrCreateWorkflowInTx } from "./workflow";
import { ScheduleConflictError } from "../errors";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { ScheduleRow } from "../infra/db/types/schedule";
import { candidateHashes } from "../lib/hash";

export function getReferenceId(scheduleId: string, occurrence: number) {
	return `schedule:${scheduleId}:${occurrence}`;
}

export interface DueOccurrences {
	/** Occurrences due at or before `now`, oldest first. */
	occurrences: NonEmptyArray<number>;
	/** The occurrence after the last due one. */
	nextRunAt: number;
}

interface OccurrenceRange {
	/** Occurrences in the range, oldest first. */
	occurrences: NonEmptyArray<number>;
	/** The first occurrence after the range. */
	next: number;
}

/**
 * Every occurrence of `spec` between `from` and `to`, both inclusive. Interval occurrences fall
 * every `everyMs` starting at `from`; cron occurrences are the times the expression matches.
 * Returns null when the range holds no occurrence.
 */
function getOccurrencesBetween(spec: ScheduleSpec, from: number, to: number): OccurrenceRange | null {
	const occurrences: number[] = [];
	let next: number;

	if (spec.type === "cron") {
		// next() is strict, so the cursor starts one millisecond before `from` to count an occurrence at `from` itself.
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(from - 1),
			tz: spec.timezone,
		});
		next = parsed.next().getTime();
		while (next <= to) {
			occurrences.push(next);
			next = parsed.next().getTime();
		}
	} else {
		next = from;
		while (next <= to) {
			occurrences.push(next);
			next += spec.everyMs;
		}
	}

	if (!isNonEmptyArray(occurrences)) {
		return null;
	}
	return { occurrences, next };
}

/**
 * The last occurrence of `spec` between `from` and `to`, both inclusive. Interval occurrences fall
 * every `everyMs` starting at `from`; cron occurrences are the times the expression matches.
 * Returns null when the range holds no occurrence.
 */
function getLastOccurrenceBetween(spec: ScheduleSpec, from: number, to: number): OccurrenceRange | null {
	if (spec.type === "cron") {
		// prev() is strict, so the cursor starts one millisecond past `to` to count an occurrence at `to` itself.
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(to + 1),
			tz: spec.timezone,
		});
		const last = parsed.prev().getTime();
		if (last < from) {
			return null;
		}
		// The parser's cursor now sits on `last`, so next() is the occurrence after it.
		return { occurrences: [last], next: parsed.next().getTime() };
	}

	if (from > to) {
		return null;
	}
	const intervalsPassed = Math.floor((to - from) / spec.everyMs);
	const last = from + intervalsPassed * spec.everyMs;
	return { occurrences: [last], next: last + spec.everyMs };
}

/**
 * What a schedule owes as of `now`, counted from its next run, and when it runs after that.
 * Returns null while the next run is still ahead.
 */
export function getDueOccurrences(schedule: Pick<Schedule, "spec" | "nextRunAt">, now: number): DueOccurrences | null {
	const { spec, nextRunAt } = schedule;
	const overlapPolicy = spec.overlapPolicy ?? "skip";
	const range =
		overlapPolicy === "allow"
			? getOccurrencesBetween(spec, nextRunAt, now)
			: getLastOccurrenceBetween(spec, nextRunAt, now);
	if (!range) {
		return null;
	}
	return { occurrences: range.occurrences, nextRunAt: range.next };
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
	async activateSchedule(
		namespaceId: NamespaceId,
		request: ScheduleActivateRequestV1
	): Promise<{ schedule: Schedule }> {
		const definitionHashes = await hashScheduleDefinitions(request);
		return repos.transaction(async (txRepos) => activateScheduleInTx(namespaceId, request, definitionHashes, txRepos));
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

/** The definition hash under each rotation the request's input hash carries. */
async function hashScheduleDefinitions(request: ScheduleActivateRequestV1): Promise<Hash> {
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

	const [currentHash, deprecatedHashes, nextHash] = await Promise.all([
		hashDefinition(workflowRunInputHash.value),
		Promise.all((workflowRunInputHash.deprecatedValues ?? []).map(hashDefinition)),
		workflowRunInputHash.nextValue === undefined ? undefined : hashDefinition(workflowRunInputHash.nextValue),
	]);

	return { value: currentHash, deprecatedValues: deprecatedHashes, nextValue: nextHash };
}

interface SchedulePayload {
	workflowRunInput: OpaquePayload | null;
	workflowRunInputHash: string;
	clientHasherApplied: boolean;
	clientCodecApplied: boolean;
	definitionHash: string;
}

async function activateScheduleInTx(
	namespaceId: NamespaceId,
	request: ScheduleActivateRequestV1,
	definitionHashes: Hash,
	txRepos: TxRepositories
) {
	const { workflowName, workflowVersionId, workflowRunOptions, spec, options } = request;
	const currentDefinitionHash = definitionHashes.value;
	// The activating client computed these together, with its own codec and keys, so they are
	// always stored together: a row mixing one client's input with another's hash or declaration
	// would mint runs whose input does not decode.
	const payload: SchedulePayload = {
		workflowRunInput: request.workflowRunInput ?? null,
		workflowRunInputHash: request.workflowRunInputHash.value,
		clientHasherApplied: request.clientHasherApplied,
		clientCodecApplied: request.clientCodecApplied,
		definitionHash: currentDefinitionHash,
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
			definitionHashes: candidateHashes(definitionHashes),
		});

		const schedule = existingScheduleByDefinition
			? await reuseSchedule(txRepos.schedule, {
					namespaceId,
					existing: existingScheduleByDefinition,
					payload,
					nextDefinitionHash: definitionHashes.nextValue,
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
		if (!candidateHashes(definitionHashes).includes(existingScheduleByReference.definitionHash)) {
			if (conflictPolicy === "error") {
				throw new ScheduleConflictError({ definitionHash: currentDefinitionHash, referenceId });
			}
			conflictPolicy satisfies "return_existing";
			return { schedule: scheduleRowToDomain(existingScheduleByReference, workflowInfo) };
		}

		const schedule = await reuseSchedule(txRepos.schedule, {
			namespaceId,
			existing: existingScheduleByReference,
			payload,
			nextDefinitionHash: definitionHashes.nextValue,
		});

		return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
	}

	// Reference id is free, but the definition may already exist.
	const existingNonReferencedSchedule = await txRepos.schedule.get(namespaceId, {
		definitionHashes: candidateHashes(definitionHashes),
		referenceId: null,
	});

	if (existingNonReferencedSchedule) {
		const updates: Partial<SchedulePayload> & { referenceId: string; status: "active" } = {
			referenceId,
			status: "active",
		};
		// Matching the request's next hash means the stored schedule was written by a client that
		// has already switched to the rotation this request has only been told about. The stored
		// payload is the newer one, so it stays.
		if (existingNonReferencedSchedule.definitionHash !== definitionHashes.nextValue) {
			updates.workflowRunInput = payload.workflowRunInput;
			updates.workflowRunInputHash = payload.workflowRunInputHash;
			updates.clientHasherApplied = payload.clientHasherApplied;
			updates.clientCodecApplied = payload.clientCodecApplied;
			updates.definitionHash = payload.definitionHash;
		}
		const schedule = await txRepos.schedule.update(
			namespaceId,
			{ id: existingNonReferencedSchedule.id, referenceId: null },
			updates
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
		nextDefinitionHash: string | undefined;
	}
): Promise<ScheduleRow> {
	const { existing, payload } = params;
	const needsActivation = existing.status !== "active";
	// Matching the request's next hash means the stored schedule was written by a client that has
	// already switched to the rotation this request has only been told about. The stored payload
	// is the newer one, so it stays. The stored input itself is never compared: a codec may encode
	// the same input differently each time, and an unchanged hash and declaration mean the stored
	// value still decodes.
	const payloadChanged =
		existing.definitionHash !== params.nextDefinitionHash &&
		(existing.workflowRunInputHash !== payload.workflowRunInputHash ||
			existing.definitionHash !== payload.definitionHash ||
			existing.clientHasherApplied !== payload.clientHasherApplied ||
			existing.clientCodecApplied !== payload.clientCodecApplied);

	if (!needsActivation && !payloadChanged) {
		return existing;
	}

	const updates: Partial<SchedulePayload> & { status?: "active" } = {};

	if (needsActivation) {
		updates.status = "active";
	}

	if (payloadChanged) {
		updates.workflowRunInput = payload.workflowRunInput;
		updates.workflowRunInputHash = payload.workflowRunInputHash;
		updates.clientHasherApplied = payload.clientHasherApplied;
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
		clientHasherApplied: payload.clientHasherApplied,
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
		clientHasherApplied: schedule.clientHasherApplied,
		clientCodecApplied: schedule.clientCodecApplied,
		referenceId: schedule.referenceId ?? undefined,
		workflowRunOptions: schedule.workflowRunOptions ?? undefined,
		createdAt: schedule.createdAt,
		updatedAt: schedule.updatedAt,
		lastOccurrence: schedule.lastOccurrence ?? undefined,
		nextRunAt: schedule.nextRunAt,
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
