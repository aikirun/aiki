import { toMilliseconds } from "@aikirun/lib";
import { type ObjectBuilder, objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import type { DurationObject } from "@aikirun/types/duration";
import type { ScheduleActivateOptions, ScheduleId, ScheduleOverlapPolicy, ScheduleSpec } from "@aikirun/types/schedule";

import type { EventsDefinition } from "./run/event";
import type { WorkflowVersion } from "./workflow-version";

export interface CronScheduleParams {
	type: "cron";
	expression: string;
	timezone?: string;
	overlapPolicy?: ScheduleOverlapPolicy;
}

export interface IntervalScheduleParams {
	type: "interval";
	every: DurationObject;
	overlapPolicy?: ScheduleOverlapPolicy;
}

export type ScheduleParams = CronScheduleParams | IntervalScheduleParams;

export interface ScheduleHandle {
	id: ScheduleId;
	pause(): Promise<void>;
	resume(): Promise<void>;
	delete(): Promise<void>;
}

export interface ScheduleBuilder {
	opt<Path extends PathFromObject<ScheduleActivateOptions>>(
		path: Path,
		value: TypeOfValueAtPath<ScheduleActivateOptions, Path>
	): ScheduleBuilder;

	activate<Input, Output, AppContext, TEvents extends EventsDefinition>(
		client: Client<AppContext>,
		workflow: WorkflowVersion<Input, Output, AppContext, TEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle>;
}

export type ScheduleDefinition = ScheduleParams & {
	with(): ScheduleBuilder;

	activate<Input, Output, AppContext, TEvents extends EventsDefinition>(
		client: Client<AppContext>,
		workflow: WorkflowVersion<Input, Output, AppContext, TEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle>;
};

export function schedule(params: ScheduleParams): ScheduleDefinition {
	async function activateWithOpts<Input, Output, AppContext, TEvents extends EventsDefinition>(
		client: Client<AppContext>,
		workflow: WorkflowVersion<Input, Output, AppContext, TEvents>,
		options: ScheduleActivateOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle> {
		const input = args[0];

		let scheduleSpec: ScheduleSpec;
		if (params.type === "interval") {
			const { every, ...rest } = params;
			scheduleSpec = {
				...rest,
				everyMs: toMilliseconds(every),
			};
		} else {
			scheduleSpec = params;
		}

		const { schedule } = await client.api.schedule.activateV1({
			workflowName: workflow.name,
			workflowVersionId: workflow.versionId,
			spec: scheduleSpec,
			input,
			options,
		});
		client.logger.info("Schedule activated", {
			scheduleSpec,
			workflowName: workflow.name,
			workflowVersionId: workflow.versionId,
			referenceId: options?.reference?.id,
		});

		const scheduleId = schedule.id as ScheduleId;

		return {
			id: scheduleId,
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
	}

	function createBuilder(optsBuilder: ObjectBuilder<ScheduleActivateOptions>): ScheduleBuilder {
		return {
			opt: (path, value) => createBuilder(optsBuilder.with(path, value)),
			async activate(client, workflow, ...args) {
				return activateWithOpts(client, workflow, optsBuilder.build(), ...args);
			},
		};
	}

	return {
		...params,

		with(): ScheduleBuilder {
			const optsOverrider = objectOverrider<ScheduleActivateOptions>({});
			return createBuilder(optsOverrider());
		},

		async activate(client, workflow, ...args) {
			return activateWithOpts(client, workflow, {}, ...args);
		},
	};
}
