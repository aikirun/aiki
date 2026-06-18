import type { ScheduleActivateRequestV1 } from "@aikirun/types/api/schedule";
import type { CronScheduleSpec, IntervalScheduleSpec } from "@aikirun/types/schedule";
import { Factory } from "fishery";

export const intervalScheduleActivateRequestFactory = Factory.define<
	ScheduleActivateRequestV1 & { spec: IntervalScheduleSpec }
>(() => ({
	workflowName: "workflow",
	workflowVersionId: "1.0.0",
	options: {},
	spec: { type: "interval", everyMs: 1_000 },
}));

export const cronScheduleActivateRequestFactory = Factory.define<
	ScheduleActivateRequestV1 & { spec: CronScheduleSpec }
>(() => ({
	workflowName: "workflow",
	workflowVersionId: "1.0.0",
	options: {},
	spec: { type: "cron", expression: "* * * * *" },
}));
