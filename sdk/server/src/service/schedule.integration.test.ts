import { createBinaryLatch } from "@aikirun/lib/async";
import { hashInput } from "@aikirun/lib/crypto";
import { asOpaquePayload } from "@aikirun/testing/payload";

import { createScheduleService, type ScheduleService } from "./schedule";
import { describe, expect, test } from "bun:test";
import { InvalidScheduleStateTransitionError } from "../errors";
import type { Repositories } from "../infra/db/types";
import { withFakeClock } from "../testing/clock";
import { createServiceHarness, withRepos } from "../testing/harness";

const withHarness = createServiceHarness();

describe("ScheduleService activateSchedule", () => {
	test("persists the cron timezone", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
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
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: previousHash },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});

			const { schedule: matched } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: {
					value: await hashInput(workflowRunInput),
					deprecatedValues: [previousHash],
				},
				clientHasherApplied: false,
				clientCodecApplied: false,
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
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: previousHash },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});
			const stored = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			expect(stored).toEqual(expect.objectContaining({ workflowRunInputHash: previousHash }));

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: currentHash, deprecatedValues: [previousHash] },
				clientHasherApplied: false,
				clientCodecApplied: false,
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
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: "previous-hash" },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});
			const { schedule: current } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
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
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: previousHash },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
				options,
			});
			const { schedule: matched } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: {
					value: await hashInput(workflowRunInput),
					deprecatedValues: [previousHash],
				},
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
				options,
			});

			expect(matched.id).toBe(created.id);
		}));

	test("stores the current input hash after matching a referenced schedule via a deprecated value", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const spec = { type: "interval" as const, everyMs: 60_000 };
			const previousHash = "previous-hash";
			const currentHash = await hashInput(workflowRunInput);
			const options = { reference: { id: "invoices-eu-west" } };

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: previousHash },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
				options,
			});
			const stored = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			expect(stored).toEqual(expect.objectContaining({ workflowRunInputHash: previousHash }));

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: currentHash, deprecatedValues: [previousHash] },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
				options,
			});

			const migrated = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			expect(migrated).toEqual(expect.objectContaining({ id: schedule.id, workflowRunInputHash: currentHash }));
			expect(migrated?.definitionHash).not.toBe(stored?.definitionHash);
		}));
});

describe("ScheduleService activateSchedule recording the client codec", () => {
	const spec = { type: "interval" as const, everyMs: 60_000 };

	test("stores the activating client's input and declaration", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const encodedInput = asOpaquePayload({ encoded: "eu-west" });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: encodedInput,
				workflowRunInputHash: { value: await hashInput({ region: "eu-west" }) },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});

			expect(await scheduleService.getScheduleById(context.namespaceId, schedule.id)).toEqual(
				expect.objectContaining({
					schedule: expect.objectContaining({
						id: schedule.id,
						workflowRunInput: encodedInput,
						clientCodecApplied: true,
					}),
				})
			);
		}));

	test("rewrites the stored input and declaration together with the hashes when matched via a deprecated value", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const previousHash = "previous-hash";
			const currentHash = await hashInput(workflowRunInput);
			const encodedInput = asOpaquePayload({ encoded: "eu-west" });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: previousHash },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: encodedInput,
				workflowRunInputHash: { value: currentHash, deprecatedValues: [previousHash] },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({
					id: schedule.id,
					workflowRunInput: encodedInput,
					workflowRunInputHash: currentHash,
					clientCodecApplied: true,
				})
			);
		}));

	test("rewrites the stored input when only the declaration changes", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const workflowRunInputHash = { value: await hashInput(workflowRunInput) };
			const encodedInput = asOpaquePayload({ encoded: "eu-west" });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash,
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});

			// Same plaintext, so the same hashes: only the declaration and the stored bytes differ.
			const { schedule: reactivated } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: encodedInput,
				workflowRunInputHash,
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});

			expect(reactivated.id).toBe(schedule.id);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ id: schedule.id, workflowRunInput: encodedInput, clientCodecApplied: true })
			);
		}));

	test("leaves the stored input untouched when the hashes and declaration are unchanged", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInputHash = { value: await hashInput({ region: "eu-west" }) };
			// A codec may encode the same input differently each time; the stored bytes still decode.
			const firstEncoding = asOpaquePayload({ encoded: "eu-west", nonce: 1 });
			const secondEncoding = asOpaquePayload({ encoded: "eu-west", nonce: 2 });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: firstEncoding,
				workflowRunInputHash,
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: secondEncoding,
				workflowRunInputHash,
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ id: schedule.id, workflowRunInput: firstEncoding, clientCodecApplied: true })
			);
		}));

	test("adopting a free reference id onto an unreferenced schedule rewrites its input and declaration from the request", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const workflowRunInputHash = { value: await hashInput(workflowRunInput) };
			const encodedInput = asOpaquePayload({ encoded: "eu-west" });

			const { schedule: unreferenced } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash,
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});

			const { schedule: referenced } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: encodedInput,
				workflowRunInputHash,
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
				options: { reference: { id: "invoices-eu-west" } },
			});

			expect(referenced.id).toBe(unreferenced.id);
			expect(await repos.schedule.get(context.namespaceId, { id: unreferenced.id })).toEqual(
				expect.objectContaining({
					id: unreferenced.id,
					referenceId: "invoices-eu-west",
					workflowRunInput: encodedInput,
					clientCodecApplied: true,
				})
			);
		}));
});

describe("ScheduleService activateSchedule recording the client hasher", () => {
	const spec = { type: "interval" as const, everyMs: 60_000 };
	const workflowRunInput = { region: "eu-west" };

	test("stores the activating client's hasher declaration", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: "client-hash" },
				clientHasherApplied: true,
				clientCodecApplied: false,
				spec,
			});

			expect(await scheduleService.getScheduleById(context.namespaceId, schedule.id)).toEqual(
				expect.objectContaining({
					schedule: expect.objectContaining({ id: schedule.id, clientHasherApplied: true }),
				})
			);
		}));

	test("rewrites the stored payload when only the hasher declaration changes", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInputHash = { value: await hashInput(workflowRunInput) };
			const firstInput = asOpaquePayload({ region: "eu-west", sent: 1 });
			const secondInput = asOpaquePayload({ region: "eu-west", sent: 2 });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: firstInput,
				workflowRunInputHash,
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});

			// Same hashes and codec declaration; only the hasher declaration differs.
			const { schedule: reactivated } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: secondInput,
				workflowRunInputHash,
				clientHasherApplied: true,
				clientCodecApplied: false,
				spec,
			});

			expect(reactivated.id).toBe(schedule.id);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ id: schedule.id, workflowRunInput: secondInput, clientHasherApplied: true })
			);
		}));
});

describe("ScheduleService activateSchedule under an announced key", () => {
	const spec = { type: "interval" as const, everyMs: 60_000 };
	const workflowRunInput = { region: "eu-west" };
	// Written under the announced key by a client one rotation ahead.
	const announcedHash = "announced-hash";
	const aheadInput = asOpaquePayload({ encoded: "eu-west", key: "2025" });
	const behindInput = asOpaquePayload({ encoded: "eu-west", key: "2024" });

	test("matches a schedule stored under the announced hash and leaves its payload alone", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: aheadInput,
				workflowRunInputHash: { value: announcedHash },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});
			const stored = await repos.schedule.get(context.namespaceId, { id: schedule.id });

			const { schedule: matched } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: behindInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput), nextValue: announcedHash },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});

			expect(matched.id).toBe(schedule.id);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(stored);
		}));

	test("recognises a referenced schedule stored under the announced hash and leaves its payload alone", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const options = { reference: { id: "invoices-eu-west" } };

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: aheadInput,
				workflowRunInputHash: { value: announcedHash },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
				options,
			});
			const stored = await repos.schedule.get(context.namespaceId, { id: schedule.id });

			const { schedule: matched } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: behindInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput), nextValue: announcedHash },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
				options,
			});

			expect(matched.id).toBe(schedule.id);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(stored);
		}));

	test("adopting a reference id onto a schedule stored under the announced hash leaves its payload alone", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });

			const { schedule: unreferenced } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: aheadInput,
				workflowRunInputHash: { value: announcedHash },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
			});

			const { schedule: referenced } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: behindInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput), nextValue: announcedHash },
				clientHasherApplied: false,
				clientCodecApplied: true,
				spec,
				options: { reference: { id: "invoices-eu-west" } },
			});

			expect(referenced.id).toBe(unreferenced.id);
			expect(await repos.schedule.get(context.namespaceId, { id: unreferenced.id })).toEqual(
				expect.objectContaining({
					id: unreferenced.id,
					referenceId: "invoices-eu-west",
					workflowRunInput: aheadInput,
					workflowRunInputHash: announcedHash,
					clientCodecApplied: true,
				})
			);
		}));
});

describe("ScheduleService activateSchedule and the next run", () => {
	const spec = { type: "interval" as const, everyMs: 60_000 };

	test("activating a paused schedule again leaves it paused with its next run untouched", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const request = {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			};

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);

			// Two periods on
			const { schedule: reactivated } = await withFakeClock(schedule.nextRunAt + 120_000, () =>
				scheduleService.activateSchedule(context.namespaceId, request)
			);

			expect(reactivated.id).toBe(schedule.id);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ id: schedule.id, status: "paused", nextRunAt: schedule.nextRunAt })
			);
		}));

	test("adopting a reference id onto an unreferenced schedule leaves its next run untouched", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const request = {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			};

			const { schedule: unreferenced } = await scheduleService.activateSchedule(context.namespaceId, request);

			// Two periods on
			const { schedule: referenced } = await withFakeClock(unreferenced.nextRunAt + 120_000, () =>
				scheduleService.activateSchedule(context.namespaceId, {
					...request,
					options: { reference: { id: "invoices-eu-west" } },
				})
			);

			expect(referenced.id).toBe(unreferenced.id);
			expect(await repos.schedule.get(context.namespaceId, { id: unreferenced.id })).toEqual(
				expect.objectContaining({
					id: unreferenced.id,
					referenceId: "invoices-eu-west",
					nextRunAt: unreferenced.nextRunAt,
				})
			);
		}));
});

describe("ScheduleService status transitions", () => {
	const spec = { type: "interval" as const, everyMs: 60_000 };

	async function activationRequest() {
		const workflowRunInput = { region: "eu-west" };
		return {
			workflowName: "send-invoices",
			workflowVersionId: "v1",
			workflowRunInput: asOpaquePayload(workflowRunInput),
			workflowRunInputHash: { value: await hashInput(workflowRunInput) },
			clientHasherApplied: false,
			clientCodecApplied: false,
			spec,
		};
	}

	test("activating a new schedule writes an activated transition the schedule points at", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, await activationRequest());

			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows).toEqual([
				expect.objectContaining({
					type: "schedule",
					scheduleId: schedule.id,
					status: "active",
					state: { status: "active", reason: "activated" },
				}),
			]);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ status: "active", latestStateTransitionId: rows[0]?.id })
			);
		}));

	test("resuming a paused schedule writes a resumed transition", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, await activationRequest());
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);

			await scheduleService.resumeSchedule(context.namespaceId, schedule.id);

			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows).toEqual([
				expect.objectContaining({ status: "active", state: { status: "active", reason: "resumed" } }),
				expect.objectContaining({ status: "paused", state: { status: "paused" } }),
				expect.objectContaining({ status: "active", state: { status: "active", reason: "activated" } }),
			]);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ status: "active", latestStateTransitionId: rows[0]?.id })
			);
		}));

	test("deactivating writes an inactive transition", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, await activationRequest());

			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows).toEqual([
				expect.objectContaining({ status: "inactive", state: { status: "inactive" } }),
				expect.objectContaining({ status: "active", state: { status: "active", reason: "activated" } }),
			]);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ status: "inactive", latestStateTransitionId: rows[0]?.id })
			);
		}));

	test("activating a paused schedule again writes nothing", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const request = await activationRequest();
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);

			const { schedule: returned } = await scheduleService.activateSchedule(context.namespaceId, request);

			expect(returned.id).toBe(schedule.id);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
				rows: [
					expect.objectContaining({ status: "paused", state: { status: "paused" } }),
					expect.objectContaining({ status: "active", state: { status: "active", reason: "activated" } }),
				],
				total: 2,
			});
		}));

	test("activating a deactivated schedule again writes a reactivated transition", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const request = await activationRequest();
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			const { schedule: reactivated } = await scheduleService.activateSchedule(context.namespaceId, request);

			expect(reactivated.id).toBe(schedule.id);
			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows).toEqual([
				expect.objectContaining({ status: "active", state: { status: "active", reason: "reactivated" } }),
				expect.objectContaining({ status: "inactive", state: { status: "inactive" } }),
				expect.objectContaining({ status: "active", state: { status: "active", reason: "activated" } }),
			]);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ status: "active", latestStateTransitionId: rows[0]?.id })
			);
		}));

	test("resuming a deactivated schedule is refused", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, await activationRequest());
			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			expect(scheduleService.resumeSchedule(context.namespaceId, schedule.id)).rejects.toThrow(
				InvalidScheduleStateTransitionError
			);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
				rows: [expect.objectContaining({ status: "inactive" }), expect.objectContaining({ status: "active" })],
				total: 2,
			});
		}));

	test("pausing a deactivated schedule is refused", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, await activationRequest());
			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			expect(scheduleService.pauseSchedule(context.namespaceId, schedule.id)).rejects.toThrow(
				InvalidScheduleStateTransitionError
			);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
				rows: [expect.objectContaining({ status: "inactive" }), expect.objectContaining({ status: "active" })],
				total: 2,
			});
		}));

	test("adopting a reference id onto an active schedule writes no transition", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const request = await activationRequest();
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);

			await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				options: { reference: { id: "invoices-eu-west" } },
			});

			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows).toEqual([expect.objectContaining({ state: { status: "active", reason: "activated" } })]);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ referenceId: "invoices-eu-west", latestStateTransitionId: rows[0]?.id })
			);
		}));

	test("adopting a reference id onto a paused schedule renames it and writes nothing", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const request = await activationRequest();
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);

			await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				options: { reference: { id: "invoices-eu-west" } },
			});

			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows).toEqual([
				expect.objectContaining({ status: "paused", state: { status: "paused" } }),
				expect.objectContaining({ status: "active", state: { status: "active", reason: "activated" } }),
			]);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({
					status: "paused",
					referenceId: "invoices-eu-west",
					latestStateTransitionId: rows[0]?.id,
				})
			);
		}));

	test("adopting a reference id onto a deactivated schedule writes a reactivated transition", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const request = await activationRequest();
			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				options: { reference: { id: "invoices-eu-west" } },
			});

			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows).toEqual([
				expect.objectContaining({ status: "active", state: { status: "active", reason: "reactivated" } }),
				expect.objectContaining({ status: "inactive" }),
				expect.objectContaining({ status: "active", state: { status: "active", reason: "activated" } }),
			]);
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({
					status: "active",
					referenceId: "invoices-eu-west",
					latestStateTransitionId: rows[0]?.id,
				})
			);
		}));

	test("two concurrent pauses write one transition", () =>
		withHarness(async ({ context, repos }) =>
			withRepos(async (secondaryRepos) => {
				const service = createScheduleService({ repos });
				const { schedule } = await service.activateSchedule(context.namespaceId, await activationRequest());

				await runConcurrentScheduleOperations(
					repos,
					secondaryRepos,
					(primary) => primary.pauseSchedule(context.namespaceId, schedule.id),
					(secondary) => secondary.pauseSchedule(context.namespaceId, schedule.id)
				);

				expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
					rows: [
						expect.objectContaining({ state: { status: "paused" } }),
						expect.objectContaining({ state: { status: "active", reason: "activated" } }),
					],
					total: 2,
				});
			})
		));

	test("a concurrent resume after a repeated pause leaves the schedule active", () =>
		withHarness(async ({ context, repos }) =>
			withRepos(async (secondaryRepos) => {
				const service = createScheduleService({ repos });
				const { schedule } = await service.activateSchedule(context.namespaceId, await activationRequest());
				await service.pauseSchedule(context.namespaceId, schedule.id);

				await runConcurrentScheduleOperations(
					repos,
					secondaryRepos,
					(primary) => primary.pauseSchedule(context.namespaceId, schedule.id),
					(secondary) => secondary.resumeSchedule(context.namespaceId, schedule.id)
				);

				expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
					expect.objectContaining({ status: "active" })
				);
				expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
					rows: [
						expect.objectContaining({ state: { status: "active", reason: "resumed" } }),
						expect.objectContaining({ state: { status: "paused" } }),
						expect.objectContaining({ state: { status: "active", reason: "activated" } }),
					],
					total: 3,
				});
			})
		));

	test("reference adoption racing with reactivation returns the same schedule", () =>
		withHarness(async ({ context, repos }) =>
			withRepos(async (secondaryRepos) => {
				const service = createScheduleService({ repos });
				const request = await activationRequest();
				const { schedule } = await service.activateSchedule(context.namespaceId, request);
				await service.deactivateSchedule(context.namespaceId, schedule.id);

				const { schedule: adopted } = await runConcurrentScheduleOperations(
					repos,
					secondaryRepos,
					(primary) => primary.activateSchedule(context.namespaceId, request),
					(secondary) =>
						secondary.activateSchedule(context.namespaceId, {
							...request,
							options: { reference: { id: "invoices-eu-west" } },
						})
				);

				expect(adopted).toEqual(
					expect.objectContaining({
						id: schedule.id,
						status: "active",
						referenceId: "invoices-eu-west",
						nextRunAt: schedule.nextRunAt,
					})
				);
				expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
					rows: [
						expect.objectContaining({ state: { status: "active", reason: "reactivated" } }),
						expect.objectContaining({ state: { status: "inactive" } }),
						expect.objectContaining({ state: { status: "active", reason: "activated" } }),
					],
					total: 3,
				});
			})
		));

	test("a payload upgrade survives a concurrent reactivation", () =>
		withHarness(async ({ context, repos }) =>
			withRepos(async (secondaryRepos) => {
				const service = createScheduleService({ repos });
				const request = await activationRequest();
				const { schedule } = await service.activateSchedule(context.namespaceId, request);
				await service.deactivateSchedule(context.namespaceId, schedule.id);
				const nextInput = asOpaquePayload({ encrypted: "rotated-invoices" });

				await runConcurrentScheduleOperations(
					repos,
					secondaryRepos,
					(primary) => primary.activateSchedule(context.namespaceId, request),
					(secondary) =>
						secondary.activateSchedule(context.namespaceId, {
							...request,
							workflowRunInput: nextInput,
							workflowRunInputHash: { value: "rotated-hash", deprecatedValues: [request.workflowRunInputHash.value] },
							clientHasherApplied: true,
							clientCodecApplied: true,
						})
				);

				expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
					expect.objectContaining({
						status: "active",
						workflowRunInput: nextInput,
						workflowRunInputHash: "rotated-hash",
						clientHasherApplied: true,
						clientCodecApplied: true,
					})
				);
			})
		));

	test("an older activation preserves a concurrently upgraded payload", () =>
		withHarness(async ({ context, repos }) =>
			withRepos(async (secondaryRepos) => {
				const service = createScheduleService({ repos });
				const request = await activationRequest();
				const { schedule } = await service.activateSchedule(context.namespaceId, request);
				const nextInput = asOpaquePayload({ encrypted: "rotated-invoices" });

				await runConcurrentScheduleOperations(
					repos,
					secondaryRepos,
					(primary) =>
						primary.activateSchedule(context.namespaceId, {
							...request,
							workflowRunInput: nextInput,
							workflowRunInputHash: { value: "rotated-hash", deprecatedValues: [request.workflowRunInputHash.value] },
							clientHasherApplied: true,
							clientCodecApplied: true,
						}),
					(secondary) =>
						secondary.activateSchedule(context.namespaceId, {
							...request,
							workflowRunInput: asOpaquePayload({ encrypted: "older-invoices" }),
							workflowRunInputHash: { ...request.workflowRunInputHash, nextValue: "rotated-hash" },
							clientCodecApplied: true,
						})
				);

				expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
					expect.objectContaining({
						workflowRunInput: nextInput,
						workflowRunInputHash: "rotated-hash",
						clientHasherApplied: true,
						clientCodecApplied: true,
					})
				);
			})
		));
});

async function runConcurrentScheduleOperations<T>(
	primaryRepos: Repositories,
	secondaryRepos: Repositories,
	primaryOperation: (service: ScheduleService) => Promise<unknown>,
	secondaryOperation: (service: ScheduleService) => Promise<T>
): Promise<T> {
	const primaryWritten = createBinaryLatch();
	const commitPrimary = createBinaryLatch();
	const secondaryReadStarted = createBinaryLatch();
	const primaryService = createScheduleService({
		repos: {
			...primaryRepos,
			transaction: (fn) =>
				primaryRepos.transaction(async (txRepos) => {
					const result = await fn(txRepos);
					primaryWritten.signal();
					await commitPrimary.wait();
					return result;
				}),
		},
	});
	const secondaryService = createScheduleService({
		repos: {
			...secondaryRepos,
			transaction: (fn) =>
				secondaryRepos.transaction((txRepos) =>
					fn({
						...txRepos,
						schedule: {
							...txRepos.schedule,
							get: (namespaceId, filter, options) => {
								const result = txRepos.schedule.get(namespaceId, filter, options);
								if (filter.id || filter.definitionHashes) {
									secondaryReadStarted.signal();
								}
								return result;
							},
						},
					})
				),
		},
	});

	const primaryPromise = primaryOperation(primaryService);
	await primaryWritten.wait();
	const secondaryPromise = secondaryOperation(secondaryService);
	await secondaryReadStarted.wait();
	commitPrimary.signal();
	await primaryPromise;
	return secondaryPromise;
}
