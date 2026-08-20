import type { DurationObject } from "@aikirun/lib/duration";
import { toMilliseconds } from "@aikirun/lib/duration";
import { type ObjectBuilder, objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import type { ScheduleActivateOptions, ScheduleId, ScheduleOverlapPolicy, ScheduleSpec } from "@aikirun/types/schedule";
import { INTERNAL } from "@aikirun/types/symbols";

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
	deactivate(): Promise<void>;
}

export interface ScheduleDefinition {
	/**
	 * Sets one option and returns a copy of {@link ScheduleDefinition}. The original is unchanged.
	 *
	 * These describe the schedule itself. What the runs it fires carry comes from the workflow you
	 * hand to {@link ScheduleDefinition.activate} — configure that with its own `with`.
	 */
	with<Path extends PathFromObject<ScheduleActivateOptions>>(
		path: Path,
		value: TypeOfValueAtPath<ScheduleActivateOptions, Path>
	): ScheduleDefinition;

	activate<Input, Output, Context, TEvents extends EventsDefinition>(
		client: Client<Context>,
		workflow: WorkflowVersion<Input, Output, Context, TEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle>;
}

export function schedule(params: ScheduleParams): ScheduleDefinition {
	return createSchedule(params, objectOverrider<ScheduleActivateOptions>({})());
}

function createSchedule(
	params: ScheduleParams,
	optionsBuilder: ObjectBuilder<ScheduleActivateOptions>
): ScheduleDefinition {
	return {
		with: (path, value) => createSchedule(params, optionsBuilder.with(path, value)),

		activate: (client, workflow, ...args) =>
			activateWithOptions(client, workflow, params, optionsBuilder.build(), ...args),
	};
}

async function activateWithOptions<Input, Output, Context, TEvents extends EventsDefinition>(
	client: Client<Context>,
	workflow: WorkflowVersion<Input, Output, Context, TEvents>,
	params: ScheduleParams,
	options: ScheduleActivateOptions,
	...args: Input extends void ? [] : [Input]
): Promise<ScheduleHandle> {
	const workflowRunInput = args[0];
	const hasher = client[INTERNAL].hasher;
	const workflowRunInputHash = await hasher(workflowRunInput);

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

	const { schedule: activatedSchedule } = await client.api.schedule.activateV1({
		workflowName: workflow.name,
		workflowVersionId: workflow.versionId,
		spec: scheduleSpec,
		workflowRunInput,
		workflowRunInputHash,
		options,
		workflowRunOptions: workflow[INTERNAL].runOptions(),
	});
	client.logger.info("Schedule activated", {
		"aiki.scheduleSpec": scheduleSpec,
		"aiki.workflowName": workflow.name,
		"aiki.workflowVersionId": workflow.versionId,
		"aiki.scheduleReferenceId": options.reference?.id,
	});

	const scheduleId = activatedSchedule.id as ScheduleId;

	return {
		id: scheduleId,

		pause: async () => {
			await client.api.schedule.pauseV1({ id: scheduleId });
		},

		resume: async () => {
			await client.api.schedule.resumeV1({ id: scheduleId });
		},

		deactivate: async () => {
			await client.api.schedule.deactivateV1({ id: scheduleId });
		},
	};
}
