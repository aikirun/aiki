import { hashInput } from "@aikirun/lib/crypto";

import { createScheduleService } from "./schedule";
import { describe, expect, test } from "bun:test";
import { createServiceHarness } from "../testing/harness";

const withHarness = createServiceHarness();

describe("ScheduleService activateSchedule", () => {
	test("persists the cron timezone", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
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

	test("matches an existing schedule by a deprecated input hash", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const spec = { type: "interval" as const, everyMs: 60_000 };
			const previousHash = "previous-hash";

			const { schedule: created } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: previousHash },
				spec,
			});

			const { schedule: matched } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: {
					value: await hashInput(workflowRunInput),
					deprecatedValues: [previousHash],
				},
				spec,
			});

			expect(matched.id).toBe(created.id);
		}));

	test("stores the current input hash after matching via a deprecated value", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const spec = { type: "interval" as const, everyMs: 60_000 };
			const previousHash = "previous-hash";
			const currentHash = await hashInput(workflowRunInput);

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: previousHash },
				spec,
			});
			const stored = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			expect(stored).toEqual(expect.objectContaining({ workflowRunInputHash: previousHash }));

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: currentHash, deprecatedValues: [previousHash] },
				spec,
			});

			const migrated = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			expect(migrated).toEqual(expect.objectContaining({ id: schedule.id, workflowRunInputHash: currentHash }));
			expect(migrated?.definitionHash).not.toBe(stored?.definitionHash);
		}));

	test("creates a distinct schedule when the input hash is new and has no deprecated values", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const spec = { type: "interval" as const, everyMs: 60_000 };

			const { schedule: previous } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: "previous-hash" },
				spec,
			});
			const { schedule: current } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				spec,
			});

			expect(current.id).not.toBe(previous.id);
		}));

	test("treats a referenced schedule as the same definition when the stored hash is deprecated", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const spec = { type: "interval" as const, everyMs: 60_000 };
			const previousHash = "previous-hash";
			const options = { reference: { id: "invoices-eu-west" } };

			const { schedule: created } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: previousHash },
				spec,
				options,
			});
			const { schedule: matched } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: {
					value: await hashInput(workflowRunInput),
					deprecatedValues: [previousHash],
				},
				spec,
				options,
			});

			expect(matched.id).toBe(created.id);
		}));
});
