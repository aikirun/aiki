import { createScheduleService } from "./schedule";
import { describe, expect, test } from "bun:test";
import { createServiceHarness } from "../testing/harness";

const withHarness = createServiceHarness();

describe("ScheduleService activateSchedule", () => {
	test("persists the cron timezone", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const { schedule } = await scheduleService.activateSchedule(context, context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: { region: "eu-west" },
				spec: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Berlin" },
			});

			const read = await scheduleService.getScheduleById(context.namespaceId, schedule.id);
			expect(read.schedule.spec).toEqual({
				type: "cron",
				expression: "0 9 * * *",
				timezone: "Europe/Berlin",
				overlapPolicy: undefined,
			});
		}));
});
