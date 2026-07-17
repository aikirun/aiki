import { namespaceAuthedImplementer } from "./implementer";
import type { ScheduleService } from "../service/schedule";

export function createScheduleRouter(scheduleService: ScheduleService) {
	const os = namespaceAuthedImplementer.schedule;

	return os.router({
		activateV1: os.activateV1.handler(async ({ input: request, context }) => {
			return scheduleService.activateSchedule(context, context.namespaceId, request);
		}),

		getByIdV1: os.getByIdV1.handler(async ({ input: request, context }) => {
			return scheduleService.getScheduleById(context.namespaceId, request.id);
		}),

		getByReferenceIdV1: os.getByReferenceIdV1.handler(async ({ input: request, context }) => {
			return scheduleService.getScheduleByReferenceId(context.namespaceId, request.referenceId);
		}),

		listV1: os.listV1.handler(async ({ input: request, context }) => {
			const { limit = 50, offset = 0, filters } = request;
			return scheduleService.listSchedules(context.namespaceId, filters, limit, offset);
		}),

		pauseV1: os.pauseV1.handler(async ({ input: request, context }) => {
			await scheduleService.pauseSchedule(context.namespaceId, request.id);
		}),

		resumeV1: os.resumeV1.handler(async ({ input: request, context }) => {
			await scheduleService.resumeSchedule(context.namespaceId, request.id);
		}),

		deactivateV1: os.deactivateV1.handler(async ({ input: request, context }) => {
			await scheduleService.deactivateSchedule(context.namespaceId, request.id);
		}),
	});
}
