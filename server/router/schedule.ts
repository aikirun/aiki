import { hashInput } from "@aikirun/lib/crypto";
import type { Schedule, ScheduleId, ScheduleName } from "@aikirun/types/schedule";
import { getNextOccurrence, getScheduleKey } from "server/services/schedule";

import { baseImplementer } from "./base";
import { NotFoundError } from "../errors";
import { schedulesById, schedulesByKey } from "../infrastructure/persistence/in-memory-store";

const os = baseImplementer.schedule;

const registerV1 = os.registerV1.handler(async ({ input: request }) => {
	const { name, workflowName, workflowVersionId, input, spec } = request;
	const scheduleName = name as ScheduleName;

	const definitionHash = await hashInput({
		name: scheduleName,
		workflowName,
		workflowVersionId,
		spec,
		input,
	});

	const key = getScheduleKey(workflowName, workflowVersionId, name);
	const existingId = schedulesByKey.get(key);
	if (existingId) {
		const existing = schedulesById.get(existingId);
		if (!existing) {
			throw new NotFoundError(`Schedule not found: ${existingId}`);
		}

		if (existing.definitionHash === definitionHash && existing.schedule.status === "active") {
			return { schedule: existing.schedule };
		}

		const now = Date.now();
		const updatedSchedule: Schedule = {
			...existing.schedule,
			spec,
			input,
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
		name: scheduleName,
		workflowName,
		workflowVersionId,
		input,
		spec,
		status: "active",
		createdAt: now,
		updatedAt: now,
		nextRunAt,
		runCount: 0,
	};

	schedulesById.set(id, { schedule, definitionHash });
	schedulesByKey.set(key, id);

	return { schedule };
});

const getByIdV1 = os.getByIdV1.handler(({ input: request }) => {
	const scheduleInfo = schedulesById.get(request.id as ScheduleId);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${request.id}`);
	}
	return { schedule: scheduleInfo.schedule };
});

const getByNameV1 = os.getByNameV1.handler(({ input: request }) => {
	const key = getScheduleKey(request.workflowName, request.workflowVersionId, request.name);
	const id = schedulesByKey.get(key);
	if (!id) {
		throw new NotFoundError(`Schedule not found: ${request.name}`);
	}
	const scheduleInfo = schedulesById.get(id);
	if (!scheduleInfo) {
		throw new NotFoundError(`Schedule not found: ${request.name}`);
	}
	return { schedule: scheduleInfo.schedule };
});

const listV1 = os.listV1.handler(({ input: request }) => {
	const { limit = 50, offset = 0, filters } = request;

	const filteredSchedules: Schedule[] = [];
	for (const { schedule } of schedulesById.values()) {
		if (filters?.status?.every((s) => s !== schedule.status)) {
			continue;
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
	registerV1,
	getByIdV1,
	getByNameV1,
	listV1,
	pauseV1,
	resumeV1,
	deleteV1,
});
