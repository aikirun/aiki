import {
	cronScheduleActivateRequestFactory,
	intervalScheduleActivateRequestFactory,
} from "@aikirun/testing/api/schedule";
import { withFakeClient } from "@aikirun/testing/client";
import { cronScheduleFactory, intervalScheduleFactory } from "@aikirun/testing/schedule";
import type { ScheduleId } from "@aikirun/types/schedule";

import { schedule } from "./schedule";
import { workflow } from "./workflow";
import { describe, expect, test } from "bun:test";

const syncInventoryWorkflow = workflow({ name: "sync-inventory" }).v<{ warehouseId: string }>("1.0.0", {
	handler: async () => {},
});

const intervalScheduleActivateRequest = intervalScheduleActivateRequestFactory.params({
	workflowName: syncInventoryWorkflow.name,
	workflowVersionId: syncInventoryWorkflow.versionId,
	workflowRunInput: { warehouseId: "wh-1" },
});
const cronScheduleActivateRequest = cronScheduleActivateRequestFactory.params({
	workflowName: syncInventoryWorkflow.name,
	workflowVersionId: syncInventoryWorkflow.versionId,
	workflowRunInput: { warehouseId: "wh-1" },
});

describe("schedule", () => {
	describe("activate", () => {
		test("maps the interval to everyMs and carries the overlap policy", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						spec: { type: "interval", overlapPolicy: "cancel_previous", everyMs: 5_000 },
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 5 }, overlapPolicy: "cancel_previous" }).activate(
					client,
					syncInventoryWorkflow,
					{ warehouseId: "wh-1" }
				);
			}));

		test("passes a cron spec through unchanged", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					cronScheduleActivateRequest.build({
						spec: { type: "cron", expression: "0 * * * *", timezone: "UTC", overlapPolicy: "skip" },
					}),
					{ schedule: cronScheduleFactory.build() }
				);

				await schedule({ type: "cron", expression: "0 * * * *", timezone: "UTC", overlapPolicy: "skip" }).activate(
					client,
					syncInventoryWorkflow,
					{ warehouseId: "wh-1" }
				);
			}));

		test("returns a handle carrying the activated schedule id", () =>
			withFakeClient(async (client) => {
				const activatedSchedule = intervalScheduleFactory.build();

				client.api.schedule.activateV1.once(expect.anything(), { schedule: activatedSchedule });

				const handle = await schedule({ type: "interval", every: { seconds: 1 } }).activate(
					client,
					syncInventoryWorkflow,
					{ warehouseId: "wh-1" }
				);

				expect(handle.id).toBe(activatedSchedule.id as ScheduleId);
			}));
	});

	describe("with builder", () => {
		test("opt sets the options sent to activate", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						options: { reference: { id: "ref-1" } },
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 1 } })
					.with()
					.opt("reference.id", "ref-1")
					.activate(client, syncInventoryWorkflow, { warehouseId: "wh-1" });
			}));
	});

	describe("workflow run options", () => {
		const retryingSyncInventoryWorkflow = workflow({ name: "sync-inventory" }).v<{ warehouseId: string }>("1.0.0", {
			handler: async () => {},
			retry: { type: "fixed", maxAttempts: 5, delayMs: 300 },
		});

		test("opt carries retry and shard to every fired run", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						workflowRunOptions: {
							retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 },
							shard: "eu",
						},
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 1 } })
					.with()
					.opt("workflowRun.retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 })
					.opt("workflowRun.shard", "eu")
					.activate(client, syncInventoryWorkflow, { warehouseId: "wh-1" });
			}));

		test("carries the workflow's declared retry default when the schedule sets no overrides", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						workflowRunOptions: { retry: { type: "fixed", maxAttempts: 5, delayMs: 300 } },
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 1 } }).activate(client, retryingSyncInventoryWorkflow, {
					warehouseId: "wh-1",
				});
			}));

		test("a schedule retry override replaces the workflow's declared default", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						workflowRunOptions: {
							retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 },
							shard: "eu",
						},
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 1 } })
					.with()
					.opt("workflowRun.retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 })
					.opt("workflowRun.shard", "eu")
					.activate(client, retryingSyncInventoryWorkflow, { warehouseId: "wh-1" });
			}));
	});

	describe("handle operations", () => {
		test("pause calls pauseV1 with the schedule id", () =>
			withFakeClient(async (client) => {
				const activatedSchedule = intervalScheduleFactory.build();

				client.api.schedule.activateV1.once(expect.anything(), { schedule: activatedSchedule });
				client.api.schedule.pauseV1.once({ id: activatedSchedule.id });

				const handle = await schedule({ type: "interval", every: { seconds: 1 } }).activate(
					client,
					syncInventoryWorkflow,
					{ warehouseId: "wh-1" }
				);
				await handle.pause();
			}));

		test("resume calls resumeV1 with the schedule id", () =>
			withFakeClient(async (client) => {
				const activatedSchedule = intervalScheduleFactory.build();

				client.api.schedule.activateV1.once(expect.anything(), { schedule: activatedSchedule });
				client.api.schedule.resumeV1.once({ id: activatedSchedule.id });

				const handle = await schedule({ type: "interval", every: { seconds: 1 } }).activate(
					client,
					syncInventoryWorkflow,
					{ warehouseId: "wh-1" }
				);
				await handle.resume();
			}));

		test("deactivate calls deactivateV1 with the schedule id", () =>
			withFakeClient(async (client) => {
				const activatedSchedule = intervalScheduleFactory.build();

				client.api.schedule.activateV1.once(expect.anything(), { schedule: activatedSchedule });
				client.api.schedule.deactivateV1.once({ id: activatedSchedule.id });

				const handle = await schedule({ type: "interval", every: { seconds: 1 } }).activate(
					client,
					syncInventoryWorkflow,
					{ warehouseId: "wh-1" }
				);
				await handle.deactivate();
			}));
	});
});
