import { createBinaryLatch, settleWithin } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
import { ValidationError } from "@aikirun/lib/error";
import { noopLogger } from "@aikirun/lib/logger";
import { MAX_TIMESTAMP_MS, type TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { SCHEDULE_CONFLICT_POLICIES, type Schedule, type ScheduleStatus } from "@aikirun/types/schedule";
import { describe, expect, test } from "vitest";

import { createScheduleService, type ScheduleService } from "./schedule";
import { InvalidScheduleStateTransitionError, ScheduleConflictError } from "../errors";
import type { Repositories } from "../infra/db/types";
import { createImminentTimerQueue } from "../infra/timer/imminent-timer-queue";
import { computeRank } from "../lib/rank";
import { withFakeClock } from "../testing/clock";
import { createServiceHarness, withRepos } from "../testing/harness";
import { allowsConcurrentWriteTransactions } from "../testing/infra/db/transaction";
import {
	type SeedScheduleDeps,
	type SeedScheduleOverrides,
	seedActiveSchedule,
	seedInactiveSchedule,
	seedPausedSchedule,
} from "../testing/seed/schedule";

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

	test("refuses an activation whose cron expression is invalid", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };

			const activating = scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "cron", expression: "61 9 * * *" },
			});

			await expect(activating).rejects.toThrow(ValidationError);
			await expect(activating).rejects.toThrow('Invalid cron expression "61 9 * * *"');
		}));

	test("refuses an activation whose cron timezone is invalid", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };

			const activating = scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "cron", expression: "0 9 * * *", timezone: "Europe/Atlantis" },
			});

			await expect(activating).rejects.toThrow(ValidationError);
			await expect(activating).rejects.toThrow('Invalid cron timezone "Europe/Atlantis"');
		}));

	test("accepts an interval that puts the first run in the last millisecond of the year 9999", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const now = Date.now();

			const { schedule } = await withFakeClock(now, async () =>
				scheduleService.activateSchedule(context.namespaceId, {
					workflowName: "send-invoices",
					workflowVersionId: "v1",
					workflowRunInput: asOpaquePayload(workflowRunInput),
					workflowRunInputHash: { value: await hashInput(workflowRunInput) },
					clientHasherApplied: false,
					clientCodecApplied: false,
					spec: { type: "interval", everyMs: MAX_TIMESTAMP_MS - now },
				})
			);

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ id: schedule.id, intervalMs: MAX_TIMESTAMP_MS - now, nextRunAt: MAX_TIMESTAMP_MS })
			);
		}));

	test("refuses an activation whose interval puts the first run after the year 9999", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };
			const now = Date.now();

			const activating = withFakeClock(now, async () =>
				scheduleService.activateSchedule(context.namespaceId, {
					workflowName: "send-invoices",
					workflowVersionId: "v1",
					workflowRunInput: asOpaquePayload(workflowRunInput),
					workflowRunInputHash: { value: await hashInput(workflowRunInput) },
					clientHasherApplied: false,
					clientCodecApplied: false,
					spec: { type: "interval", everyMs: MAX_TIMESTAMP_MS - now + 1 },
				})
			);

			await expect(activating).rejects.toThrow(ValidationError);
			await expect(activating).rejects.toThrow("The interval is too long");
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

	test("refuses an activation whose input hashes match two schedules", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const request = {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload({ region: "eu-west" }),
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval" as const, everyMs: 60_000 },
			};
			await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				workflowRunInputHash: { value: "previous-hash" },
			});
			await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				workflowRunInputHash: { value: "current-hash" },
			});

			await expect(
				scheduleService.activateSchedule(context.namespaceId, {
					...request,
					workflowRunInputHash: { value: "current-hash", deprecatedValues: ["previous-hash"] },
				})
			).rejects.toThrow(ScheduleConflictError);
		}));

	test("refuses an activation by reference id whose input hashes match two schedules", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const request = {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload({ region: "eu-west" }),
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval" as const, everyMs: 60_000 },
			};
			await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				workflowRunInputHash: { value: "previous-hash" },
				options: { reference: { id: "invoices-eu-west" } },
			});
			await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				workflowRunInputHash: { value: "current-hash" },
			});

			await expect(
				scheduleService.activateSchedule(context.namespaceId, {
					...request,
					workflowRunInputHash: { value: "current-hash", deprecatedValues: ["previous-hash"] },
					options: { reference: { id: "invoices-eu-west" } },
				})
			).rejects.toThrow(ScheduleConflictError);
		}));

	test.skipIf(!allowsConcurrentWriteTransactions())(
		"two activations by different reference ids whose input hashes match the same two schedules are both refused",
		() =>
			withHarness(async ({ context, repos }) =>
				withRepos(async (secondaryRepos) => {
					const request = {
						workflowName: "send-invoices",
						workflowVersionId: "v1",
						workflowRunInput: asOpaquePayload({ region: "eu-west" }),
						clientHasherApplied: false,
						clientCodecApplied: false,
						spec: { type: "interval" as const, everyMs: 60_000 },
					};
					const scheduleService = createScheduleService({ repos });
					await scheduleService.activateSchedule(context.namespaceId, {
						...request,
						workflowRunInputHash: { value: "previous-hash" },
						options: { reference: { id: "invoices-eu-west" } },
					});
					await scheduleService.activateSchedule(context.namespaceId, {
						...request,
						workflowRunInputHash: { value: "current-hash" },
						options: { reference: { id: "invoices-emea" } },
					});

					const primaryHoldsItsSchedule = createBinaryLatch();
					const releasePrimary = createBinaryLatch();
					const secondaryStartedItsSearch = createBinaryLatch();
					const primaryService = createScheduleService({
						repos: {
							...repos,
							transaction: (fn) =>
								repos.transaction((txRepos) =>
									fn({
										...txRepos,
										schedule: {
											...txRepos.schedule,
											listByDefinitionHashes: async (...args) => {
												primaryHoldsItsSchedule.signal();
												await releasePrimary.wait();
												return txRepos.schedule.listByDefinitionHashes(...args);
											},
										},
									})
								),
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
											listByDefinitionHashes: (...args) => {
												secondaryStartedItsSearch.signal();
												return txRepos.schedule.listByDefinitionHashes(...args);
											},
										},
									})
								),
						},
					});
					const workflowRunInputHash = { value: "current-hash", deprecatedValues: ["previous-hash"] };

					// Each activation locks the schedule under its own reference id, then searches by hash.
					// The first one pauses before its search until the second has started its own.
					const primaryActivation = Promise.allSettled([
						primaryService.activateSchedule(context.namespaceId, {
							...request,
							workflowRunInputHash,
							options: { reference: { id: "invoices-eu-west" } },
						}),
					]);
					await primaryHoldsItsSchedule.wait();
					const secondaryActivation = Promise.allSettled([
						secondaryService.activateSchedule(context.namespaceId, {
							...request,
							workflowRunInputHash,
							options: { reference: { id: "invoices-emea" } },
						}),
					]);
					await secondaryStartedItsSearch.wait();
					releasePrimary.signal();

					expect(await primaryActivation).toEqual([{ status: "rejected", reason: expect.any(ScheduleConflictError) }]);
					expect(await secondaryActivation).toEqual([
						{ status: "rejected", reason: expect.any(ScheduleConflictError) },
					]);
				})
			)
	);

	test.skipIf(!allowsConcurrentWriteTransactions())(
		"returns the schedule when another activation creates it at the same moment",
		() =>
			withHarness(async ({ context, repos }) =>
				withRepos(async (secondaryRepos) => {
					const request = {
						workflowName: "send-invoices",
						workflowVersionId: "v1",
						workflowRunInput: asOpaquePayload({ region: "eu-west" }),
						workflowRunInputHash: { value: "current-hash" },
						clientHasherApplied: false,
						clientCodecApplied: false,
						spec: { type: "interval" as const, everyMs: 60_000 },
					};
					// The workflow already exists. With a new one, the second activation would wait for
					// the first while recording the workflow, and would then find the schedule.
					await seedActiveSchedule(
						{ repos, namespaceRequestContext: context },
						{ workflowName: "send-invoices", workflowVersionId: "v1", spec: { type: "interval", everyMs: 300_000 } }
					);

					const primaryCreatedSchedule = createBinaryLatch();
					const commitPrimary = createBinaryLatch();
					const secondarySearched = createBinaryLatch();
					const primaryService = createScheduleService({
						repos: {
							...repos,
							transaction: (fn) =>
								repos.transaction(async (txRepos) => {
									const result = await fn(txRepos);
									primaryCreatedSchedule.signal();
									await commitPrimary.wait();
									return result;
								}),
						},
					});
					const secondarySearches: string[][] = [];
					const secondaryService = createScheduleService({
						repos: {
							...secondaryRepos,
							transaction: (fn) =>
								secondaryRepos.transaction((txRepos) =>
									fn({
										...txRepos,
										schedule: {
											...txRepos.schedule,
											listByDefinitionHashes: async (...args) => {
												const schedules = await txRepos.schedule.listByDefinitionHashes(...args);
												secondarySearches.push(schedules.map((schedule) => schedule.id));
												secondarySearched.signal();
												return schedules;
											},
										},
									})
								),
						},
					});

					// The first activation creates the schedule and stays open. It is committed only after
					// the second has searched and found nothing.
					const primaryActivation = primaryService.activateSchedule(context.namespaceId, request);
					await primaryCreatedSchedule.wait();
					const secondaryActivation = secondaryService.activateSchedule(context.namespaceId, request);
					await secondarySearched.wait();
					commitPrimary.signal();
					const [primaryResult, secondaryResult] = await Promise.all([primaryActivation, secondaryActivation]);

					expect(secondaryResult.schedule.id).toBe(primaryResult.schedule.id);
					expect(secondarySearches).toEqual([[], [primaryResult.schedule.id]]);
				})
			)
	);
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

	test("activating a deactivated schedule again sets its next run one period after the activation", () =>
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
			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			// One and a half periods on, so a next run still counted from the old one would differ.
			const reactivatedAt = schedule.nextRunAt + 90_000;
			await withFakeClock(reactivatedAt, () => scheduleService.activateSchedule(context.namespaceId, request));

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ id: schedule.id, status: "active", nextRunAt: reactivatedAt + 60_000 })
			);
		}));

	test("activating a deactivated schedule again by its reference id sets its next run one period after the activation", () =>
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
				options: { reference: { id: "invoices-eu-west" } },
			};

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			// One and a half periods on, so a next run still counted from the old one would differ.
			const reactivatedAt = schedule.nextRunAt + 90_000;
			await withFakeClock(reactivatedAt, () => scheduleService.activateSchedule(context.namespaceId, request));

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
				expect.objectContaining({ id: schedule.id, status: "active", nextRunAt: reactivatedAt + 60_000 })
			);
		}));

	test("adopting a reference id onto a deactivated schedule sets its next run one period after the activation", () =>
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

			const { schedule: unreferencedSchedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.deactivateSchedule(context.namespaceId, unreferencedSchedule.id);

			// One and a half periods on, so a next run still counted from the old one would differ.
			const reactivatedAt = unreferencedSchedule.nextRunAt + 90_000;
			await withFakeClock(reactivatedAt, () =>
				scheduleService.activateSchedule(context.namespaceId, {
					...request,
					options: { reference: { id: "invoices-eu-west" } },
				})
			);

			expect(await repos.schedule.get(context.namespaceId, { id: unreferencedSchedule.id })).toEqual(
				expect.objectContaining({
					id: unreferencedSchedule.id,
					status: "active",
					referenceId: "invoices-eu-west",
					nextRunAt: reactivatedAt + 60_000,
				})
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

	test("adds a new schedule's timer to the priority queue when its first run is within the lookahead", () =>
		withHarness(async ({ context, repos }) => {
			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const scheduleService = createScheduleService({
				repos,
				imminentTimerQueue: createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				}),
			});
			const workflowRunInput = { region: "eu-west" };

			const activatedAt = Date.now() as TimestampMs;
			const { schedule } = await withFakeClock(activatedAt, async () =>
				scheduleService.activateSchedule(context.namespaceId, {
					workflowName: "send-invoices",
					workflowVersionId: "v1",
					workflowRunInput: asOpaquePayload(workflowRunInput),
					workflowRunInputHash: { value: await hashInput(workflowRunInput) },
					clientHasherApplied: false,
					clientCodecApplied: false,
					spec: { type: "interval", everyMs: 5_000 },
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: activatedAt + 5_000 }) },
			]);
		}));

	test("adds no timer for a new schedule whose first run is beyond the lookahead", () =>
		withHarness(async ({ context, repos }) => {
			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const scheduleService = createScheduleService({
				repos,
				imminentTimerQueue: createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				}),
			});
			const workflowRunInput = { region: "eu-west" };

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([]);
		}));

	test("resuming a paused schedule adds its timer to the priority queue when its next run is due within the lookahead", () =>
		withHarness(async ({ context, repos }) => {
			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const scheduleService = createScheduleService({
				repos,
				imminentTimerQueue: createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				}),
			});
			const workflowRunInput = { region: "eu-west" };

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec,
			});
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);

			// Two periods on
			await withFakeClock(schedule.nextRunAt + 120_000, () =>
				scheduleService.resumeSchedule(context.namespaceId, schedule.id)
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: schedule.nextRunAt }) },
			]);
		}));

	test("activating a deactivated schedule again adds its timer to the priority queue when its next run is due within the lookahead", () =>
		withHarness(async ({ context, repos }) => {
			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const scheduleService = createScheduleService({
				repos,
				imminentTimerQueue: createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				}),
			});
			const workflowRunInput = { region: "eu-west" };
			const request = {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: { type: "interval" as const, everyMs: 5_000 },
			};

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.deactivateSchedule(context.namespaceId, schedule.id);

			// One and a half periods on
			const reactivatedAt = schedule.nextRunAt + 7_500;
			await withFakeClock(reactivatedAt, () => scheduleService.activateSchedule(context.namespaceId, request));

			// The first timer is the one added when the schedule was created.
			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: schedule.nextRunAt }) },
				{ type: "recurring", id: schedule.id, rank: computeRank({ dueAt: reactivatedAt + 5_000 }) },
			]);
		}));
});

describe("ScheduleService activateSchedule and reference ids", () => {
	const everyMinute = { type: "interval" as const, everyMs: 60_000 };
	const everyFiveMinutes = { type: "interval" as const, everyMs: 300_000 };

	const seedScheduleByStatus = {
		active: seedActiveSchedule,
		paused: seedPausedSchedule,
		inactive: seedInactiveSchedule,
	} satisfies Record<
		ScheduleStatus,
		(deps: SeedScheduleDeps, overrides?: SeedScheduleOverrides) => Promise<{ schedule: Schedule }>
	>;

	for (const [status, seedSchedule] of Object.entries(seedScheduleByStatus)) {
		test(`activating another definition under the ${status} schedule's reference id is refused and leaves the schedule untouched`, () =>
			withHarness(async ({ context, repos }) => {
				const scheduleService = createScheduleService({ repos });
				const { schedule } = await seedSchedule(
					{ repos, namespaceRequestContext: context },
					{ spec: everyMinute, referenceId: "invoices-eu-west" }
				);
				const scheduleBefore = await repos.schedule.get(context.namespaceId, { id: schedule.id });
				const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);
				const workflowRunInput = { region: "eu-west" };
				const request = {
					workflowName: "send-invoices",
					workflowVersionId: "v1",
					workflowRunInput: asOpaquePayload(workflowRunInput),
					workflowRunInputHash: { value: await hashInput(workflowRunInput) },
					clientHasherApplied: false,
					clientCodecApplied: false,
					spec: everyFiveMinutes,
				};

				await expect(
					scheduleService.activateSchedule(context.namespaceId, {
						...request,
						options: { reference: { id: "invoices-eu-west" } },
					})
				).rejects.toThrow(ScheduleConflictError);

				expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(scheduleBefore);
				expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
			}));

		test(`activating another definition under the ${status} schedule's reference id with return_existing returns the schedule untouched`, () =>
			withHarness(async ({ context, repos }) => {
				const scheduleService = createScheduleService({ repos });
				const { schedule } = await seedSchedule(
					{ repos, namespaceRequestContext: context },
					{ spec: everyMinute, referenceId: "invoices-eu-west" }
				);
				const scheduleBefore = await repos.schedule.get(context.namespaceId, { id: schedule.id });
				const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);
				const workflowRunInput = { region: "eu-west" };
				const request = {
					workflowName: "send-invoices",
					workflowVersionId: "v1",
					workflowRunInput: asOpaquePayload(workflowRunInput),
					workflowRunInputHash: { value: await hashInput(workflowRunInput) },
					clientHasherApplied: false,
					clientCodecApplied: false,
					spec: everyFiveMinutes,
				};

				const { schedule: returnedSchedule } = await scheduleService.activateSchedule(context.namespaceId, {
					...request,
					options: { reference: { id: "invoices-eu-west", conflictPolicy: "return_existing" } },
				});

				expect(returnedSchedule).toEqual(expect.objectContaining({ id: schedule.id, status, spec: everyMinute }));
				expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(scheduleBefore);
				expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
			}));
	}

	test("activating another workflow under a schedule's reference id with return_existing returns the schedule with its own workflow", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const { schedule } = await seedActiveSchedule(
				{ repos, namespaceRequestContext: context },
				{ workflowName: "send-invoices", workflowVersionId: "v1", referenceId: "invoices-eu-west" }
			);
			const workflowRunInput = { region: "eu-west" };

			const { schedule: returnedSchedule } = await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "archive-orders",
				workflowVersionId: "v2",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: everyMinute,
				options: { reference: { id: "invoices-eu-west", conflictPolicy: "return_existing" } },
			});

			expect(returnedSchedule).toEqual(
				expect.objectContaining({ id: schedule.id, workflowName: "send-invoices", workflowVersionId: "v1" })
			);
		}));

	test("activating another workflow under a schedule's reference id with return_existing creates no workflow for the request", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			await seedActiveSchedule(
				{ repos, namespaceRequestContext: context },
				{ workflowName: "send-invoices", workflowVersionId: "v1", referenceId: "invoices-eu-west" }
			);
			const workflowRunInput = { region: "eu-west" };

			await scheduleService.activateSchedule(context.namespaceId, {
				workflowName: "archive-orders",
				workflowVersionId: "v2",
				workflowRunInput: asOpaquePayload(workflowRunInput),
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				spec: everyMinute,
				options: { reference: { id: "invoices-eu-west", conflictPolicy: "return_existing" } },
			});

			expect(
				await repos.workflow.listByNameAndVersionPairs(context.namespaceId, [
					{ source: "user", name: "archive-orders", versionId: "v2" },
				])
			).toEqual([]);
		}));

	for (const conflictPolicy of SCHEDULE_CONFLICT_POLICIES) {
		test(`activating a referenced schedule's definition under another reference id is refused with conflict policy ${conflictPolicy}`, () =>
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
					spec: everyMinute,
				};

				const { schedule } = await scheduleService.activateSchedule(context.namespaceId, {
					...request,
					options: { reference: { id: "invoices-eu-west" } },
				});

				await expect(
					scheduleService.activateSchedule(context.namespaceId, {
						...request,
						options: { reference: { id: "invoices-emea", conflictPolicy } },
					})
				).rejects.toThrow(ScheduleConflictError);

				expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(
					expect.objectContaining({ id: schedule.id, referenceId: "invoices-eu-west" })
				);
			}));
	}

	test("activating a referenced schedule's definition without a reference id returns that schedule untouched", () =>
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
				spec: everyMinute,
			};

			const { schedule: referencedSchedule } = await scheduleService.activateSchedule(context.namespaceId, {
				...request,
				options: { reference: { id: "invoices-eu-west" } },
			});
			const scheduleBefore = await repos.schedule.get(context.namespaceId, { id: referencedSchedule.id });

			const { schedule: returnedSchedule } = await scheduleService.activateSchedule(context.namespaceId, request);

			expect(returnedSchedule).toEqual(
				expect.objectContaining({ id: referencedSchedule.id, referenceId: "invoices-eu-west" })
			);
			expect(await repos.schedule.get(context.namespaceId, { id: referencedSchedule.id })).toEqual(scheduleBefore);
		}));

	test("activating an active schedule again by its reference id returns it and leaves the schedule and its history untouched", () =>
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
				spec: everyMinute,
				options: { reference: { id: "invoices-eu-west" } },
			};

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			const scheduleBefore = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);

			// Two periods on
			const { schedule: returnedSchedule } = await withFakeClock(schedule.nextRunAt + 120_000, () =>
				scheduleService.activateSchedule(context.namespaceId, request)
			);

			expect(returnedSchedule).toEqual(expect.objectContaining({ id: schedule.id, referenceId: "invoices-eu-west" }));
			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(scheduleBefore);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
		}));

	test("activating a paused schedule again by its reference id leaves the schedule and its history untouched", () =>
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
				spec: everyMinute,
				options: { reference: { id: "invoices-eu-west" } },
			};

			const { schedule } = await scheduleService.activateSchedule(context.namespaceId, request);
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);
			const scheduleBefore = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);

			// Two periods on
			await withFakeClock(schedule.nextRunAt + 120_000, () =>
				scheduleService.activateSchedule(context.namespaceId, request)
			);

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(scheduleBefore);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
		}));

	test("two concurrent adoptions of one unreferenced schedule under different reference ids keep the first reference id and refuse the second", () =>
		withHarness(async ({ context, repos }) =>
			withRepos(async (secondaryRepos) => {
				const scheduleService = createScheduleService({ repos });
				const workflowRunInput = { region: "eu-west" };
				const request = {
					workflowName: "send-invoices",
					workflowVersionId: "v1",
					workflowRunInput: asOpaquePayload(workflowRunInput),
					workflowRunInputHash: { value: await hashInput(workflowRunInput) },
					clientHasherApplied: false,
					clientCodecApplied: false,
					spec: everyMinute,
				};
				const { schedule: unreferencedSchedule } = await scheduleService.activateSchedule(context.namespaceId, request);

				await expect(
					runConcurrentScheduleOperations(
						repos,
						secondaryRepos,
						(primary) =>
							primary.activateSchedule(context.namespaceId, {
								...request,
								options: { reference: { id: "invoices-eu-west" } },
							}),
						(secondary) =>
							secondary.activateSchedule(context.namespaceId, {
								...request,
								options: { reference: { id: "invoices-emea" } },
							})
					)
				).rejects.toThrow(ScheduleConflictError);

				expect(await repos.schedule.get(context.namespaceId, { id: unreferencedSchedule.id })).toEqual(
					expect.objectContaining({ id: unreferencedSchedule.id, referenceId: "invoices-eu-west" })
				);
			})
		));

	test.skipIf(!allowsConcurrentWriteTransactions())(
		"two concurrent activations of different definitions under one new reference id create the first and refuse the second",
		() =>
			withHarness(async ({ context, repos }) =>
				withRepos(async (secondaryRepos) => {
					const request = {
						workflowName: "send-invoices",
						workflowVersionId: "v1",
						clientHasherApplied: false,
						clientCodecApplied: false,
						spec: everyMinute,
						options: { reference: { id: "invoices-eu" } },
					};
					// The workflow already exists. With a new one, the second activation would wait for
					// the first while recording the workflow, and would then find the reference id taken.
					await seedActiveSchedule(
						{ repos, namespaceRequestContext: context },
						{ workflowName: "send-invoices", workflowVersionId: "v1", spec: everyFiveMinutes }
					);

					const primaryCreatedSchedule = createBinaryLatch();
					const commitPrimary = createBinaryLatch();
					const secondarySearched = createBinaryLatch();
					const primaryService = createScheduleService({
						repos: {
							...repos,
							transaction: (fn) =>
								repos.transaction(async (txRepos) => {
									const result = await fn(txRepos);
									primaryCreatedSchedule.signal();
									await commitPrimary.wait();
									return result;
								}),
						},
					});
					const secondaryReferenceLookups: (string | null)[] = [];
					const secondaryService = createScheduleService({
						repos: {
							...secondaryRepos,
							transaction: (fn) =>
								secondaryRepos.transaction((txRepos) =>
									fn({
										...txRepos,
										schedule: {
											...txRepos.schedule,
											get: async (...args) => {
												const schedule = await txRepos.schedule.get(...args);
												secondaryReferenceLookups.push(schedule?.id ?? null);
												return schedule;
											},
											listByDefinitionHashes: async (...args) => {
												const schedules = await txRepos.schedule.listByDefinitionHashes(...args);
												secondarySearched.signal();
												return schedules;
											},
										},
									})
								),
						},
					});

					// The first activation creates the schedule and stays open. It is committed only after
					// the second has looked for the reference id and for its own definition.
					const primaryActivation = primaryService.activateSchedule(context.namespaceId, {
						...request,
						workflowRunInput: asOpaquePayload({ region: "eu-west" }),
						workflowRunInputHash: { value: "eu-west-hash" },
					});
					await primaryCreatedSchedule.wait();
					const secondaryActivation = Promise.allSettled([
						secondaryService.activateSchedule(context.namespaceId, {
							...request,
							workflowRunInput: asOpaquePayload({ region: "eu-north" }),
							workflowRunInputHash: { value: "eu-north-hash" },
						}),
					]);
					await secondarySearched.wait();
					commitPrimary.signal();
					const primaryResult = await primaryActivation;

					expect(await secondaryActivation).toEqual([
						{ status: "rejected", reason: expect.any(ScheduleConflictError) },
					]);
					expect(secondaryReferenceLookups).toEqual([null, primaryResult.schedule.id]);
				})
			)
	);
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

			await expect(scheduleService.resumeSchedule(context.namespaceId, schedule.id)).rejects.toThrow(
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

			await expect(scheduleService.pauseSchedule(context.namespaceId, schedule.id)).rejects.toThrow(
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
	const secondaryService = createScheduleService({ repos: secondaryRepos });

	const primaryPromise = primaryOperation(primaryService);
	await primaryWritten.wait();
	const secondaryPromise = secondaryOperation(secondaryService);
	// The second operation cannot finish while the first is open: it needs the schedule the first holds.
	expect(await settleWithin(secondaryPromise, 100)).toBe(false);
	commitPrimary.signal();
	await primaryPromise;
	return secondaryPromise;
}
