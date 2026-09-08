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

import { transitionScheduleInTx, writeScheduleStateInTx } from "./state-machine/schedule";
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
	/** The occurrence after the last one returned. Still due when the cap cut the count short. */
	nextRunAt: number;
}

interface OccurrenceRange {
	/** Occurrences in the range, oldest first. */
	occurrences: NonEmptyArray<number>;
	/** The first occurrence after the last one returned. */
	next: number;
}

/**
 * Every occurrence of `spec` between `from` and `to`, both inclusive, up to `limit` of them. Interval
 * occurrences fall every `everyMs` starting at `from`; cron occurrences are the times the expression matches.
 * Returns null when the range holds no occurrence.
 */
function getOccurrencesBetween(params: {
	spec: ScheduleSpec;
	from: number;
	to: number;
	limit: number;
}): OccurrenceRange | null {
	const { spec, from, to, limit } = params;

	const occurrences: number[] = [];
	let next: number;

	if (spec.type === "cron") {
		// next() is strict, so the cursor starts one millisecond before `from` to count an occurrence at `from` itself.
		const parsed = CronExpressionParser.parse(spec.expression, {
			currentDate: new Date(from - 1),
			tz: spec.timezone,
		});
		next = parsed.next().getTime();
		while (next <= to && occurrences.length < limit) {
			occurrences.push(next);
			next = parsed.next().getTime();
		}
	} else {
		next = from;
		while (next <= to && occurrences.length < limit) {
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
function getLastOccurrenceBetween(params: { spec: ScheduleSpec; from: number; to: number }): OccurrenceRange | null {
	const { spec, from, to } = params;

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
 * What a schedule owes as of `now`, counted from its next run and at most `maxOccurrences` of it,
 * and when it runs after that. Returns null while the next run is still ahead.
 */
export function getDueOccurrences(params: {
	schedule: Pick<Schedule, "spec" | "nextRunAt">;
	now: number;
	maxOccurrences: number;
}): DueOccurrences | null {
	const { schedule, now, maxOccurrences } = params;

	const { spec, nextRunAt } = schedule;
	const overlapPolicy = spec.overlapPolicy ?? "skip";
	const range =
		overlapPolicy === "allow"
			? getOccurrencesBetween({ spec, from: nextRunAt, to: now, limit: maxOccurrences })
			: getLastOccurrenceBetween({ spec, from: nextRunAt, to: now });
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
		await repos.transaction((txRepos) =>
			transitionScheduleInTx(txRepos, { namespaceId, id, state: { status: "paused" } })
		);
	},

	async resumeSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		await repos.transaction((txRepos) =>
			transitionScheduleInTx(txRepos, {
				namespaceId,
				id,
				state: { status: "active", reason: "resumed" },
			})
		);
	},

	async deactivateSchedule(namespaceId: NamespaceId, id: string): Promise<void> {
		await repos.transaction((txRepos) =>
			transitionScheduleInTx(txRepos, { namespaceId, id, state: { status: "inactive" } })
		);
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
		const existingScheduleByDefinition = await txRepos.schedule.get(
			namespaceId,
			{ definitionHashes: candidateHashes(definitionHashes) },
			{ lock: "update" }
		);

		const schedule = existingScheduleByDefinition
			? await activateExistingSchedule(txRepos, {
					namespaceId,
					existing: existingScheduleByDefinition,
					payload,
					nextDefinitionHash: definitionHashes.nextValue,
				})
			: await createSchedule(txRepos, {
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

	const existingScheduleByReference = await txRepos.schedule.get(namespaceId, { referenceId }, { lock: "update" });
	if (existingScheduleByReference) {
		if (!candidateHashes(definitionHashes).includes(existingScheduleByReference.definitionHash)) {
			if (conflictPolicy === "error") {
				throw new ScheduleConflictError({ definitionHash: currentDefinitionHash, referenceId });
			}
			conflictPolicy satisfies "return_existing";
			return { schedule: scheduleRowToDomain(existingScheduleByReference, workflowInfo) };
		}

		const schedule = await activateExistingSchedule(txRepos, {
			namespaceId,
			existing: existingScheduleByReference,
			payload,
			nextDefinitionHash: definitionHashes.nextValue,
		});

		return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
	}

	// Reference id is free, but the definition may already exist.
	const existingNonReferencedSchedule = await txRepos.schedule.get(
		namespaceId,
		{ definitionHashes: candidateHashes(definitionHashes), referenceId: null },
		{ lock: "update" }
	);

	if (existingNonReferencedSchedule) {
		const schedule = await activateExistingSchedule(txRepos, {
			namespaceId,
			existing: existingNonReferencedSchedule,
			payload,
			nextDefinitionHash: definitionHashes.nextValue,
			referenceIdToAttach: referenceId,
		});
		return { schedule: scheduleRowToDomain(schedule, workflowInfo) };
	}

	const schedule = await createSchedule(txRepos, {
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

async function activateExistingSchedule(
	txRepos: TxRepositories,
	params: {
		namespaceId: NamespaceId;
		existing: ScheduleRow;
		payload: SchedulePayload;
		nextDefinitionHash: string | undefined;
		referenceIdToAttach?: string;
	}
): Promise<ScheduleRow> {
	// Callers lock the matching schedule before entering this function. A reference is supplied
	// only after the locked lookup confirmed the schedule has none, so attaching it cannot
	// overwrite a reference assigned by another activation.
	const { existing, payload } = params;
	// A paused schedule stays paused: only `resume` ends a pause.
	const needsReactivation = existing.status === "inactive";

	// The announced next hash identifies a newer stored payload that this client must preserve.
	// Otherwise, attaching a reference records the activating client's payload. Repeated
	// activation without attachment keeps equivalent input: a randomized codec can produce
	// different bytes for the same input, so hashes and declarations decide whether to write.
	const shouldWritePayload =
		existing.definitionHash !== params.nextDefinitionHash &&
		(params.referenceIdToAttach !== undefined ||
			existing.workflowRunInputHash !== payload.workflowRunInputHash ||
			existing.definitionHash !== payload.definitionHash ||
			existing.clientHasherApplied !== payload.clientHasherApplied ||
			existing.clientCodecApplied !== payload.clientCodecApplied);

	if (!needsReactivation && !shouldWritePayload && params.referenceIdToAttach === undefined) {
		return existing;
	}

	const updates: Partial<SchedulePayload> & { referenceId?: string } = {};
	if (params.referenceIdToAttach !== undefined) {
		updates.referenceId = params.referenceIdToAttach;
	}

	if (shouldWritePayload) {
		updates.workflowRunInput = payload.workflowRunInput;
		updates.workflowRunInputHash = payload.workflowRunInputHash;
		updates.clientHasherApplied = payload.clientHasherApplied;
		updates.clientCodecApplied = payload.clientCodecApplied;
		updates.definitionHash = payload.definitionHash;
	}

	if (!needsReactivation) {
		const updatedRow = await txRepos.schedule.update(params.namespaceId, { id: existing.id }, updates);
		if (!updatedRow) {
			throw new NotFoundError(`Schedule not found: ${existing.id}`);
		}
		return updatedRow;
	}

	return writeScheduleStateInTx(txRepos, {
		namespaceId: params.namespaceId,
		id: existing.id,
		state: { status: "active", reason: "reactivated" },
		updates,
	});
}

async function createSchedule(
	txRepos: TxRepositories,
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
	const transitionId = ulid();
	const created = await txRepos.schedule.create({
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
		latestStateTransitionId: transitionId,
	});
	await txRepos.stateTransition.append({
		id: transitionId,
		type: "schedule",
		scheduleId: created.id,
		state: { status: "active", reason: "activated" },
	});
	return created;
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
