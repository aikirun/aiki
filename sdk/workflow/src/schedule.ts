import type { DurationObject } from "@aikirun/lib/duration";
import { toMilliseconds } from "@aikirun/lib/duration";
import { type ObjectBuilder, objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import type {
	ScheduleActivateOptions,
	ScheduledWorkflowStartOptions,
	ScheduleId,
	ScheduleOverlapPolicy,
	ScheduleSpec,
} from "@aikirun/types/schedule";
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

type ScheduleBuilderActivateOptions = ScheduleActivateOptions & {
	workflowRun?: ScheduledWorkflowStartOptions;
};

export interface ScheduleBuilder {
	opt<Path extends PathFromObject<ScheduleBuilderActivateOptions>>(
		path: Path,
		value: TypeOfValueAtPath<ScheduleBuilderActivateOptions, Path>
	): ScheduleBuilder;

	activate<Input, Output, Context, TEvents extends EventsDefinition>(
		client: Client<Context>,
		workflow: WorkflowVersion<Input, Output, Context, TEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle>;
}

export type ScheduleDefinition = ScheduleParams & {
	with(): ScheduleBuilder;

	activate<Input, Output, Context, TEvents extends EventsDefinition>(
		client: Client<Context>,
		workflow: WorkflowVersion<Input, Output, Context, TEvents>,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle>;
};

export function schedule(params: ScheduleParams): ScheduleDefinition {
	async function activateWithOptions<Input, Output, Context, TEvents extends EventsDefinition>(
		client: Client<Context>,
		workflow: WorkflowVersion<Input, Output, Context, TEvents>,
		options: ScheduleBuilderActivateOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<ScheduleHandle> {
		const workflowRunInput = args[0];
		const { workflowRun: workflowRunOptions, ...scheduleOptions } = options;

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
			workflowRunInput,
			options: scheduleOptions,
			workflowRunOptions,
		});
		client.logger.info("Schedule activated", {
			"aiki.scheduleSpec": scheduleSpec,
			"aiki.workflowName": workflow.name,
			"aiki.workflowVersionId": workflow.versionId,
			"aiki.scheduleReferenceId": scheduleOptions.reference?.id,
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

			deactivate: async () => {
				await client.api.schedule.deactivateV1({ id: scheduleId });
			},
		};
	}

	// The builder threads its .opt() calls as a function so they can be applied at activate, once the
	// workflow (and thus its default run options) is known.
	function createBuilder(
		apply: (builder: ObjectBuilder<ScheduleBuilderActivateOptions>) => ObjectBuilder<ScheduleBuilderActivateOptions>
	): ScheduleBuilder {
		return {
			opt: (path, value) => createBuilder((builder) => apply(builder).with(path, value)),

			async activate(client, workflow, ...args) {
				const base: ScheduleBuilderActivateOptions = { workflowRun: workflow[INTERNAL].definitionStartOptions() };
				const activateOptions = apply(objectOverrider(base)()).build();
				return activateWithOptions(client, workflow, activateOptions, ...args);
			},
		};
	}

	return {
		...params,

		with(): ScheduleBuilder {
			return createBuilder((builder) => builder);
		},

		async activate(client, workflow, ...args) {
			return createBuilder((builder) => builder).activate(client, workflow, ...args);
		},
	};
}
