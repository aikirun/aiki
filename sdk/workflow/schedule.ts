import { toMilliseconds } from "@aikirun/lib";
import type { Client } from "@aikirun/types/client";
import type { DurationObject } from "@aikirun/types/duration";
import type { OverlapPolicy, ScheduleId, ScheduleName, ScheduleSpec } from "@aikirun/types/schedule";

import type { EventsDefinition } from "./run/event";
import type { WorkflowVersion } from "./workflow-version";

export interface CronScheduleParams {
	type: "cron";
	expression: string;
	timezone?: string;
	overlapPolicy?: OverlapPolicy;
}

export interface IntervalScheduleParams {
	type: "interval";
	every: DurationObject;
	overlapPolicy?: OverlapPolicy;
}

export type ScheduleParams = CronScheduleParams | IntervalScheduleParams;

export interface ScheduleHandle {
	id: ScheduleId;
	name: ScheduleName;
	pause(): Promise<void>;
	resume(): Promise<void>;
	delete(): Promise<void>;
}

export type ScheduleDefinition = ScheduleParams & {
	name: ScheduleName;

	register<Input, Output, AppContext, TEvents extends EventsDefinition>(
		client: Client<AppContext>,
		workflow: WorkflowVersion<Input, Output, AppContext, TEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle>;
};

export function schedule(params: { name: string } & ScheduleParams): ScheduleDefinition {
	const { name, ...scheduleParams } = params;

	return {
		name: name as ScheduleName,
		...scheduleParams,

		async register(client, workflow, ...args) {
			const input = args[0];

			let scheduleSpec: ScheduleSpec;
			if (scheduleParams.type === "interval") {
				const { every, ...rest } = scheduleParams;
				scheduleSpec = {
					...rest,
					everyMs: toMilliseconds(every),
				};
			} else {
				scheduleSpec = scheduleParams;
			}

			const { schedule } = await client.api.schedule.registerV1({
				name,
				workflowName: workflow.name,
				workflowVersionId: workflow.versionId,
				spec: scheduleSpec,
				input,
			});
			client.logger.info("Scheduled workflow registered", {
				scheduleSpec,
				workflowName: workflow.name,
				workflowVersionId: workflow.versionId,
			});

			const scheduleId = schedule.id as ScheduleId;

			return {
				id: scheduleId,
				name: name as ScheduleName,

				pause: async () => {
					await client.api.schedule.pauseV1({ id: scheduleId });
				},
				resume: async () => {
					await client.api.schedule.resumeV1({ id: scheduleId });
				},
				delete: async () => {
					await client.api.schedule.deleteV1({ id: scheduleId });
				},
			};
		},
	};
}
