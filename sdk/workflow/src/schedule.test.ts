import { hashInput } from "@aikirun/lib/crypto";
import { withFakeClient } from "@aikirun/testing/client";
import {
	cronScheduleActivateRequestFactory,
	intervalScheduleActivateRequestFactory,
} from "@aikirun/testing/data-factory/api/schedule";
import { cronScheduleFactory, intervalScheduleFactory } from "@aikirun/testing/data-factory/schedule";
import type { Client } from "@aikirun/types/client";
import type { ScheduleId } from "@aikirun/types/schedule";

import { schedule } from "./schedule";
import { workflow } from "./workflow";
import { describe, expect, test } from "bun:test";

const syncInventoryWorkflow = workflow({ name: "sync-inventory" }).v<{ warehouseId: string }>("1.0.0", {
	handler: async () => {},
});

const workflowRunInput = { warehouseId: "wh-1" };
const workflowRunInputHash = await hashInput(workflowRunInput);

const intervalScheduleActivateRequest = intervalScheduleActivateRequestFactory.params({
	workflowName: syncInventoryWorkflow.name,
	workflowVersionId: syncInventoryWorkflow.versionId,
	workflowRunInput,
	workflowRunInputHash: { value: workflowRunInputHash },
});
const cronScheduleActivateRequest = cronScheduleActivateRequestFactory.params({
	workflowName: syncInventoryWorkflow.name,
	workflowVersionId: syncInventoryWorkflow.versionId,
	workflowRunInput,
	workflowRunInputHash: { value: workflowRunInputHash },
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

	describe("with", () => {
		test("sets the options sent to activate", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						options: { reference: { id: "ref-1" } },
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 1 } })
					.with("reference.id", "ref-1")
					.activate(client, syncInventoryWorkflow, { warehouseId: "wh-1" });
			}));
	});

	describe("workflow run options", () => {
		const retryingSyncInventoryWorkflow = workflow({ name: "sync-inventory" }).v<{ warehouseId: string }>("1.0.0", {
			handler: async () => {},
			retry: { type: "fixed", maxAttempts: 5, delayMs: 300 },
		});

		test("carries the workflow's declared retry default", () =>
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

		test("carries the workflow's own overrides to every fired run", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						workflowRunOptions: {
							retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 },
							pool: "eu",
						},
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 1 } }).activate(
					client,
					syncInventoryWorkflow
						.with("retry", { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 })
						.with("pool", "eu"),
					{ warehouseId: "wh-1" }
				);
			}));

		test("a workflow override replaces its declared default", () =>
			withFakeClient(async (client) => {
				client.api.schedule.activateV1.once(
					intervalScheduleActivateRequest.build({
						workflowRunOptions: { retry: { type: "exponential", maxAttempts: 3, baseDelayMs: 1_000 } },
					}),
					{ schedule: intervalScheduleFactory.build() }
				);

				await schedule({ type: "interval", every: { seconds: 1 } }).activate(
					client,
					retryingSyncInventoryWorkflow.with("retry", {
						type: "exponential",
						maxAttempts: 3,
						baseDelayMs: 1_000,
					}),
					{ warehouseId: "wh-1" }
				);
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

// Compile-time guarantees, never executed. Each `@ts-expect-error` fails the build if its error stops
// being reported, so they hold the run/start option split in place.
async function _startConfiguredWorkflowIsNotSchedulable(client: Client<null>) {
	await schedule({ type: "interval", every: { seconds: 1 } }).activate(
		client,
		// @ts-expect-error a schedule mints many runs, so a workflow bound to one start cannot back one
		syncInventoryWorkflow.with("reference.id", "one-off"),
		{ warehouseId: "wh-1" }
	);

	await schedule({ type: "interval", every: { seconds: 1 } }).activate(
		client,
		syncInventoryWorkflow.with("pool", "tenant-acme"),
		{ warehouseId: "wh-1" }
	);
}
