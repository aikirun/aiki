import { hashInput } from "@aikirun/lib/crypto";
import { asOpaquePayload } from "@aikirun/testing/payload";

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
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
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
				clientCodecApplied: false,
				spec,
			});
			const { schedule: current } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
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
				clientCodecApplied: false,
				spec,
			});

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: encodedInput,
				workflowRunInputHash: { value: currentHash, deprecatedValues: [previousHash] },
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
				clientCodecApplied: false,
				spec,
			});

			// Same plaintext, so the same hashes: only the declaration and the stored bytes differ.
			const { schedule: reactivated } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: encodedInput,
				workflowRunInputHash,
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
				clientCodecApplied: true,
				spec,
			});

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: secondEncoding,
				workflowRunInputHash,
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
				clientCodecApplied: false,
				spec,
			});

			const { schedule: referenced } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: encodedInput,
				workflowRunInputHash,
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
				clientCodecApplied: true,
				spec,
			});
			const stored = await repos.schedule.get(context.namespaceId, { id: schedule.id });

			const { schedule: matched } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: behindInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput), nextValue: announcedHash },
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
				clientCodecApplied: true,
				spec,
			});

			const { schedule: referenced } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: behindInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput), nextValue: announcedHash },
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
