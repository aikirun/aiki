import { isNonEmptyArray, stableStringify } from "@aikirun/lib";
import { sha256 } from "@aikirun/lib/crypto";
import type { Schedule, ScheduleId } from "@aikirun/types/schedule";
import { getNextOccurrence } from "server/service/schedule";

import { namespaceAuthedImplementer } from "./implementer";
import { NotFoundError, ScheduleConflictError } from "../errors";
import { schedulesById, schedulesByReferenceId } from "../infra/db/in-memory-store";

const os = namespaceAuthedImplementer.schedule;

const activateV1 = os.activateV1.handler(async ({ input: request }) => {
	const { workflowName, workflowVersionId, input, spec, options } = request;
	const definitionHash = await sha256(
		stableStringify({
			workflowName,
			workflowVersionId,
			spec,
			input,
		})
	);
	const referenceId = options?.reference?.id ?? definitionHash;
	const conflictPolicy = options?.reference?.conflictPolicy ?? "upsert";

	const existingId = schedulesByReferenceId.get(referenceId);
	if (existingId) {
		const existingSchedule = schedulesById.get(existingId);
		if (!existingSchedule) {
			throw new NotFoundError(`Schedule not found: ${existingId}`);
		}

		if (existingSchedule.definitionHash === definitionHash && existingSchedule.schedule.status === "active") {
			return { schedule: existingSchedule.schedule };
		}

		if (existingSchedule.definitionHash !== definitionHash && conflictPolicy === "error") {
			throw new ScheduleConflictError(referenceId);
		}

		const now = Date.now();
		const updatedSchedule: Schedule = {
			...existingSchedule.schedule,
			workflowName,
			workflowVersionId,
			input,
			spec,
			status: "active",
			updatedAt: now,
			nextRunAt: getNextOccurrence(spec, now),
		};
		schedulesById.set(existingId, { schedule: updatedSchedule, definitionHash });
		return { schedule: updatedSchedule };
	}

	const id = crypto.randomUUID() as ScheduleId;
	const now = Date.now();
	const nextRunAt = getNextOccurrence(spec, now);

	const schedule: Schedule = {
		id,
		workflowName,
		workflowVersionId,
		input,
		spec,
		status: "active",
		options,
		createdAt: now,
		updatedAt: now,
		nextRunAt,
		runCount: 0,
	};

	schedulesById.set(id, { schedule, definitionHash });
	schedulesByReferenceId.set(referenceId, id);

	return { schedule };
});

const getByIdV1 = os.getByIdV1.handler(({ input: request }) => {
	const scheduleInfo = schedulesById.get(request.id as ScheduleId);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${request.id}`);
	}
	return { schedule: scheduleInfo.schedule };
});

const getByReferenceIdV1 = os.getByReferenceIdV1.handler(({ input: request }) => {
	const { referenceId } = request;
	const id = schedulesByReferenceId.get(referenceId);
	if (!id) {
		throw new NotFoundError(`Schedule not found with referenceId: ${referenceId}`);
	}
	const scheduleInfo = schedulesById.get(id);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${id}`);
	}
	return { schedule: scheduleInfo.schedule };
});

const listV1 = os.listV1.handler(({ input: request }) => {
	const { limit = 50, offset = 0, filters } = request;

	let scheduleInfos: Iterable<{ schedule: Schedule; definitionHash: string }>;
	if (filters?.id) {
		const scheduleInfo = schedulesById.get(filters.id as ScheduleId);
		scheduleInfos = scheduleInfo ? [scheduleInfo] : [];
	} else if (filters?.referenceId) {
		const id = schedulesByReferenceId.get(filters.referenceId);
		if (id) {
			const scheduleInfo = schedulesById.get(id);
			scheduleInfos = scheduleInfo ? [scheduleInfo] : [];
		} else {
			scheduleInfos = [];
		}
	} else {
		scheduleInfos = schedulesById.values();
	}

	const filteredSchedules: Schedule[] = [];
	for (const { schedule } of scheduleInfos) {
		if (filters?.id && filters.id !== schedule.id) {
			continue;
		}

		if (filters?.referenceId && filters.referenceId !== schedule.options?.reference?.id) {
			continue;
		}

		if (filters?.status && !filters.status.includes(schedule.status)) {
			continue;
		}

		if (filters?.workflows && isNonEmptyArray(filters.workflows)) {
			const matchesAnyWorkflowFilter = filters.workflows.some(
				(w) =>
					(!w.name || schedule.workflowName.startsWith(w.name)) &&
					(!w.versionId || w.versionId === schedule.workflowVersionId)
			);
			if (!matchesAnyWorkflowFilter) {
				continue;
			}
		}

		filteredSchedules.push(schedule);
	}

	filteredSchedules.sort((a, b) => b.createdAt - a.createdAt);

	return {
		schedules: filteredSchedules.slice(offset, offset + limit),
		total: filteredSchedules.length,
	};
});

const pauseV1 = os.pauseV1.handler(({ input: request }) => {
	const id = request.id as ScheduleId;
	const scheduleInfo = schedulesById.get(id);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${id}`);
	}

	const updatedSchedule: Schedule = {
		...scheduleInfo.schedule,
		status: "paused",
		updatedAt: Date.now(),
	};
	schedulesById.set(id, { schedule: updatedSchedule, definitionHash: scheduleInfo.definitionHash });

	return { schedule: updatedSchedule };
});

const resumeV1 = os.resumeV1.handler(({ input: request }) => {
	const id = request.id as ScheduleId;
	const scheduleInfo = schedulesById.get(id);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${id}`);
	}

	const updatedSchedule: Schedule = {
		...scheduleInfo.schedule,
		status: "active",
		updatedAt: Date.now(),
	};
	schedulesById.set(id, { schedule: updatedSchedule, definitionHash: scheduleInfo.definitionHash });

	return { schedule: updatedSchedule };
});

const deleteV1 = os.deleteV1.handler(({ input: request }) => {
	const id = request.id as ScheduleId;
	const scheduleInfo = schedulesById.get(id);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${request.id}`);
	}

	const updatedSchedule: Schedule = {
		...scheduleInfo.schedule,
		status: "deleted",
		updatedAt: Date.now(),
	};

	schedulesById.set(id, { schedule: updatedSchedule, definitionHash: scheduleInfo.definitionHash });
});

export const scheduleRouter = os.router({
	activateV1,
	getByIdV1,
	getByReferenceIdV1,
	listV1,
	pauseV1,
	resumeV1,
	deleteV1,
});
