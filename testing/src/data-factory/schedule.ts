import type { CronScheduleSpec, IntervalScheduleSpec, Schedule } from "@aikirun/types/schedule";
import { Factory } from "fishery";

export const intervalScheduleFactory = Factory.define<Schedule & { spec: IntervalScheduleSpec }>(({ sequence }) => ({
	id: `schedule-${sequence}`,
	workflowName: "workflow",
	workflowVersionId: "1.0.0",
	status: "active",
	spec: { type: "interval", everyMs: 1_000 },
	createdAt: 0,
	updatedAt: 0,
	nextRunAt: 0,
}));

export const cronScheduleFactory = Factory.define<Schedule & { spec: CronScheduleSpec }>(({ sequence }) => ({
	id: `schedule-${sequence}`,
	workflowName: "workflow",
	workflowVersionId: "1.0.0",
	status: "active",
	spec: { type: "cron", expression: "* * * * *" },
	createdAt: 0,
	updatedAt: 0,
	nextRunAt: 0,
}));
