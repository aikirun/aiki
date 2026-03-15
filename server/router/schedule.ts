import type { ScheduleService } from "server/service/schedule";

import { namespaceAuthedImplementer } from "./implementer";

export function createScheduleRouter(scheduleService: ScheduleService) {
	const os = namespaceAuthedImplementer.schedule;

	const activateV1 = os.activateV1.handler(async ({ input: request, context }) => {
		return scheduleService.activateSchedule(context, context.namespaceId, request);
	});

	const getByIdV1 = os.getByIdV1.handler(async ({ input: request, context }) => {
		return scheduleService.getScheduleById(context.namespaceId, request.id);
	});

	const getByReferenceIdV1 = os.getByReferenceIdV1.handler(async ({ input: request, context }) => {
		return scheduleService.getScheduleByReferenceId(context.namespaceId, request.referenceId);
	});

	const listV1 = os.listV1.handler(async ({ input: request, context }) => {
		const { limit = 50, offset = 0, filters } = request;
		return scheduleService.listSchedules(context.namespaceId, filters, limit, offset);
	});

	const pauseV1 = os.pauseV1.handler(async ({ input: request, context }) => {
		await scheduleService.pauseSchedule(context.namespaceId, request.id);
	});

	const resumeV1 = os.resumeV1.handler(async ({ input: request, context }) => {
		await scheduleService.resumeSchedule(context.namespaceId, request.id);
	});

	const deleteV1 = os.deleteV1.handler(async ({ input: request, context }) => {
		await scheduleService.deleteSchedule(context.namespaceId, request.id);
	});

	return os.router({
		activateV1,
		getByIdV1,
		getByReferenceIdV1,
		listV1,
		pauseV1,
		resumeV1,
		deleteV1,
	});
}
