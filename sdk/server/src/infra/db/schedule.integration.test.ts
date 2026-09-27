import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { Schedule, ScheduleSpec, ScheduleStatus } from "@aikirun/types/schedule";
import { ulid } from "ulidx";

import type { Repositories } from "./types";
import { describe, expect, test } from "bun:test";
import { ScheduleConflictError } from "../../errors";
import { END_OF_TIME, withFakeClock } from "../../testing/clock";
import { daemonContextFactory, namespaceRequestContextFactory } from "../../testing/data-factory/middleware/context";
import { createServiceHarness } from "../../testing/harness";
import {
	type SeedScheduleDeps,
	seedActiveSchedule,
	seedInactiveSchedule,
	seedPausedSchedule,
} from "../../testing/seed/schedule";

const withHarness = createServiceHarness();

const ONE_MINUTE = 60_000;
const everyMinute: ScheduleSpec = { type: "interval", everyMs: ONE_MINUTE };

async function getScheduleRow(repos: Repositories, namespaceId: NamespaceId, id: string) {
	const schedule = await repos.schedule.get(namespaceId, { id });
	if (!schedule) {
		throw new Error(`Schedule not found: ${id}`);
	}
	return schedule;
}

/** The workflow columns a joined read carries, as the activation response reported them. */
function workflowColumnsOf(schedule: Schedule) {
	return {
		workflowSource: schedule.workflowSource,
		workflowName: schedule.workflowName,
		workflowVersionId: schedule.workflowVersionId,
	};
}

describe("schedule repository bulkUpdateOccurrence", () => {
	test("leaves the schedule untouched when the expected nextRunAt does not match", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const currentNextRunAt = schedule.nextRunAt as TimestampMs;

			await repos.schedule.bulkUpdateOccurrence([
				{
					filter: { id: schedule.id, nextRunAt: (currentNextRunAt - 60_000) as TimestampMs },
					update: {
						lastOccurrence: currentNextRunAt,
						nextRunAt: (currentNextRunAt + 60_000) as TimestampMs,
					},
				},
			]);

			expect(await getScheduleRow(repos, context.namespaceId, schedule.id)).toEqual(
				expect.objectContaining({
					lastOccurrence: null,
					nextRunAt: currentNextRunAt,
				})
			);
		}));

	test("advances only the schedules whose expected nextRunAt matches", () =>
		withHarness(async ({ context, repos }) => {
			const matchedSeed = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const mismatchedSeed = await seedActiveSchedule(
				{ namespaceRequestContext: context, repos },
				{ workflowName: "send-reminders" }
			);
			const matchedNextRunAt = matchedSeed.schedule.nextRunAt as TimestampMs;
			const mismatchedNextRunAt = mismatchedSeed.schedule.nextRunAt as TimestampMs;

			await repos.schedule.bulkUpdateOccurrence([
				{
					filter: { id: matchedSeed.schedule.id, nextRunAt: matchedNextRunAt },
					update: {
						lastOccurrence: matchedNextRunAt,
						nextRunAt: (matchedNextRunAt + 60_000) as TimestampMs,
					},
				},
				{
					filter: { id: mismatchedSeed.schedule.id, nextRunAt: (mismatchedNextRunAt - 60_000) as TimestampMs },
					update: { nextRunAt: (mismatchedNextRunAt + 60_000) as TimestampMs },
				},
			]);

			expect(await getScheduleRow(repos, context.namespaceId, matchedSeed.schedule.id)).toEqual(
				expect.objectContaining({
					lastOccurrence: matchedNextRunAt,
					nextRunAt: matchedNextRunAt + 60_000,
				})
			);
			expect(await getScheduleRow(repos, context.namespaceId, mismatchedSeed.schedule.id)).toEqual(
				expect.objectContaining({
					lastOccurrence: null,
					nextRunAt: mismatchedNextRunAt,
				})
			);
		}));

	test("keeps the stored last occurrence when a matching update omits one", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const firstOccurrence = schedule.nextRunAt as TimestampMs;
			const secondOccurrence = (firstOccurrence + ONE_MINUTE) as TimestampMs;

			await repos.schedule.bulkUpdateOccurrence([
				{
					filter: { id: schedule.id, nextRunAt: firstOccurrence },
					update: { lastOccurrence: firstOccurrence, nextRunAt: secondOccurrence },
				},
			]);
			await repos.schedule.bulkUpdateOccurrence([
				{
					filter: { id: schedule.id, nextRunAt: secondOccurrence },
					update: { nextRunAt: (secondOccurrence + ONE_MINUTE) as TimestampMs },
				},
			]);

			expect(await getScheduleRow(repos, context.namespaceId, schedule.id)).toEqual(
				expect.objectContaining({
					lastOccurrence: firstOccurrence,
					nextRunAt: secondOccurrence + ONE_MINUTE,
				})
			);
		}));
});

describe("schedule repository create", () => {
	test("rejects a second schedule with the same definition in the namespace", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const row = await getScheduleRow(repos, context.namespaceId, schedule.id);

			expect(repos.schedule.create({ ...row, id: ulid() })).rejects.toThrow(ScheduleConflictError);
		}));

	test("rejects a second schedule with the same reference id in the namespace", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule(
				{ namespaceRequestContext: context, repos },
				{ referenceId: "monthly-close" }
			);
			const row = await getScheduleRow(repos, context.namespaceId, schedule.id);

			expect(repos.schedule.create({ ...row, id: ulid(), definitionHash: "another-definition" })).rejects.toThrow(
				ScheduleConflictError
			);
		}));

	test("creates the same definition in another namespace and returns it", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const row = await getScheduleRow(repos, context.namespaceId, schedule.id);
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;
			const otherScheduleId = ulid();

			expect(await repos.schedule.create({ ...row, id: otherScheduleId, namespaceId: otherNamespaceId })).toEqual(
				expect.objectContaining({ id: otherScheduleId, namespaceId: otherNamespaceId })
			);
		}));
});

describe("schedule repository update", () => {
	test("updates the schedule matched by id and returns the row", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const pauseTransitionId = ulid();

			const updated = await repos.schedule.update(
				context.namespaceId,
				{ id: schedule.id },
				{ status: "paused", latestStateTransitionId: pauseTransitionId }
			);

			expect(updated).toEqual(
				expect.objectContaining({ id: schedule.id, status: "paused", latestStateTransitionId: pauseTransitionId })
			);
			expect(updated).toEqual(await getScheduleRow(repos, context.namespaceId, schedule.id));
		}));

	test("a null reference id in the filter matches only an unreferenced schedule", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const referencedSchedule = await seedActiveSchedule(deps, { referenceId: "monthly-close" });
			const unreferencedSchedule = await seedActiveSchedule(deps, { workflowName: "send-reminders" });
			const referencedRowBefore = await getScheduleRow(repos, context.namespaceId, referencedSchedule.schedule.id);
			const pauseTransitionId = ulid();

			expect(
				await repos.schedule.update(
					context.namespaceId,
					{ id: unreferencedSchedule.schedule.id, referenceId: null },
					{ status: "paused", latestStateTransitionId: pauseTransitionId }
				)
			).toEqual(
				expect.objectContaining({
					id: unreferencedSchedule.schedule.id,
					status: "paused",
					latestStateTransitionId: pauseTransitionId,
				})
			);
			expect(
				await repos.schedule.update(
					context.namespaceId,
					{ id: referencedSchedule.schedule.id, referenceId: null },
					{ status: "paused", latestStateTransitionId: ulid() }
				)
			).toBeNull();
			expect(await getScheduleRow(repos, context.namespaceId, referencedSchedule.schedule.id)).toEqual(
				referencedRowBefore
			);
		}));

	test("a reference id in the filter matches only that reference", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule(
				{ namespaceRequestContext: context, repos },
				{ referenceId: "monthly-close" }
			);
			const rowBefore = await getScheduleRow(repos, context.namespaceId, schedule.id);

			expect(
				await repos.schedule.update(
					context.namespaceId,
					{ id: schedule.id, referenceId: "quarterly-close" },
					{ status: "paused", latestStateTransitionId: ulid() }
				)
			).toBeNull();
			expect(await getScheduleRow(repos, context.namespaceId, schedule.id)).toEqual(rowBefore);

			const pauseTransitionId = ulid();
			expect(
				await repos.schedule.update(
					context.namespaceId,
					{ id: schedule.id, referenceId: "monthly-close" },
					{ status: "paused", latestStateTransitionId: pauseTransitionId }
				)
			).toEqual(
				expect.objectContaining({ id: schedule.id, status: "paused", latestStateTransitionId: pauseTransitionId })
			);
		}));

	test("returns null and leaves the row when the namespace does not match", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const rowBefore = await getScheduleRow(repos, context.namespaceId, schedule.id);
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			expect(
				await repos.schedule.update(
					otherNamespaceId,
					{ id: schedule.id },
					{ status: "paused", latestStateTransitionId: ulid() }
				)
			).toBeNull();
			expect(await getScheduleRow(repos, context.namespaceId, schedule.id)).toEqual(rowBefore);
		}));
});

describe("schedule repository get", () => {
	test("finds a schedule by any of the given definition hashes", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const row = await getScheduleRow(repos, context.namespaceId, schedule.id);

			expect(
				await repos.schedule.get(context.namespaceId, {
					definitionHashes: ["no-such-definition", row.definitionHash],
				})
			).toEqual(row);
			expect(await repos.schedule.get(context.namespaceId, { definitionHashes: ["no-such-definition"] })).toBeNull();
		}));

	test("a null reference id matches only an unreferenced schedule, and a value matches its reference", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const referencedSchedule = await seedActiveSchedule(deps, { referenceId: "monthly-close" });
			const unreferencedSchedule = await seedActiveSchedule(deps, { workflowName: "send-reminders" });
			const referencedRow = await getScheduleRow(repos, context.namespaceId, referencedSchedule.schedule.id);
			const unreferencedRow = await getScheduleRow(repos, context.namespaceId, unreferencedSchedule.schedule.id);

			expect(await repos.schedule.get(context.namespaceId, { referenceId: null })).toEqual(unreferencedRow);
			expect(await repos.schedule.get(context.namespaceId, { referenceId: "monthly-close" })).toEqual(referencedRow);
		}));

	test("returns null from another namespace", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			expect(await repos.schedule.get(otherNamespaceId, { id: schedule.id })).toBeNull();
		}));
});

describe("schedule repository listByFilters", () => {
	async function getWorkflowRow(repos: Repositories, namespaceId: NamespaceId, schedule: Schedule) {
		const row = await repos.workflow.getByNameAndVersion(namespaceId, {
			name: schedule.workflowName,
			versionId: schedule.workflowVersionId,
			source: schedule.workflowSource,
		});
		if (!row) {
			throw new Error(
				`Workflow not found: ${schedule.workflowSource}:${schedule.workflowName}:${schedule.workflowVersionId}`
			);
		}
		return row;
	}

	function orderByScheduleId(a: { schedule: { id: string } }, b: { schedule: { id: string } }): number {
		return a.schedule.id < b.schedule.id ? -1 : 1;
	}

	test("lists the namespace's schedules with their workflow and the total, leaving out another namespace's", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const invoicesSchedule = await seedActiveSchedule(deps, { workflowName: "send-invoices" });
			const remindersSchedule = await seedActiveSchedule(deps, { workflowName: "send-reminders" });
			await seedActiveSchedule({ repos, namespaceRequestContext: namespaceRequestContextFactory.build() });
			const invoicesRow = await getScheduleRow(repos, context.namespaceId, invoicesSchedule.schedule.id);
			const remindersRow = await getScheduleRow(repos, context.namespaceId, remindersSchedule.schedule.id);

			const { rows, total } = await repos.schedule.listByFilters(context.namespaceId, {});

			expect([...rows].sort(orderByScheduleId)).toEqual(
				[
					{ schedule: invoicesRow, workflow: workflowColumnsOf(invoicesSchedule.schedule) },
					{ schedule: remindersRow, workflow: workflowColumnsOf(remindersSchedule.schedule) },
				].sort(orderByScheduleId)
			);
			expect(total).toBe(2);
		}));

	test("narrows to the given statuses", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			await seedActiveSchedule(deps, { workflowName: "send-invoices" });
			const pausedSchedule = await seedPausedSchedule(deps, { workflowName: "send-reminders" });
			const inactiveSchedule = await seedInactiveSchedule(deps, { workflowName: "archive-orders" });
			const pausedRow = await getScheduleRow(repos, context.namespaceId, pausedSchedule.schedule.id);
			const inactiveRow = await getScheduleRow(repos, context.namespaceId, inactiveSchedule.schedule.id);

			const { rows, total } = await repos.schedule.listByFilters(context.namespaceId, {
				status: ["paused", "inactive"],
			});

			expect([...rows].sort(orderByScheduleId)).toEqual(
				[
					{ schedule: pausedRow, workflow: workflowColumnsOf(pausedSchedule.schedule) },
					{ schedule: inactiveRow, workflow: workflowColumnsOf(inactiveSchedule.schedule) },
				].sort(orderByScheduleId)
			);
			expect(total).toBe(2);
		}));

	test("narrows to the given workflow ids", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const invoicesSchedule = await seedActiveSchedule(deps, { workflowName: "send-invoices" });
			await seedActiveSchedule(deps, { workflowName: "send-reminders" });
			const invoicesRow = await getScheduleRow(repos, context.namespaceId, invoicesSchedule.schedule.id);
			const invoicesWorkflow = await getWorkflowRow(repos, context.namespaceId, invoicesSchedule.schedule);

			expect(await repos.schedule.listByFilters(context.namespaceId, { workflowIds: [invoicesWorkflow.id] })).toEqual({
				rows: [{ schedule: invoicesRow, workflow: workflowColumnsOf(invoicesSchedule.schedule) }],
				total: 1,
			});
		}));

	test("narrows to the given reference id", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const referencedSchedule = await seedActiveSchedule(deps, { referenceId: "monthly-close" });
			await seedActiveSchedule(deps, { workflowName: "send-reminders" });
			const referencedRow = await getScheduleRow(repos, context.namespaceId, referencedSchedule.schedule.id);

			expect(await repos.schedule.listByFilters(context.namespaceId, { referenceId: "monthly-close" })).toEqual({
				rows: [{ schedule: referencedRow, workflow: workflowColumnsOf(referencedSchedule.schedule) }],
				total: 1,
			});
		}));

	test("narrows to the given id", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const invoicesSchedule = await seedActiveSchedule(deps, { workflowName: "send-invoices" });
			await seedActiveSchedule(deps, { workflowName: "send-reminders" });
			const invoicesRow = await getScheduleRow(repos, context.namespaceId, invoicesSchedule.schedule.id);

			expect(await repos.schedule.listByFilters(context.namespaceId, { id: invoicesSchedule.schedule.id })).toEqual({
				rows: [{ schedule: invoicesRow, workflow: workflowColumnsOf(invoicesSchedule.schedule) }],
				total: 1,
			});
		}));

	test("pages by limit and offset and still reports the full total", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			await seedActiveSchedule(deps, { workflowName: "send-invoices" });
			await seedActiveSchedule(deps, { workflowName: "send-reminders" });
			await seedActiveSchedule(deps, { workflowName: "archive-orders" });

			expect(await repos.schedule.listByFilters(context.namespaceId, {}, 1, 1)).toEqual({
				rows: [expect.anything()],
				total: 3,
			});
		}));
});

describe("schedule repository listActiveByIds", () => {
	test("lists only the active schedules among the ids, with their workflow", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const activeSchedule = await seedActiveSchedule(deps, { workflowName: "send-invoices" });
			const pausedSchedule = await seedPausedSchedule(deps, { workflowName: "send-reminders" });
			const inactiveSchedule = await seedInactiveSchedule(deps, { workflowName: "archive-orders" });
			const activeRow = await getScheduleRow(repos, context.namespaceId, activeSchedule.schedule.id);
			const absentScheduleId = ulid();

			expect(
				await repos.schedule.listActiveByIds(daemonContextFactory.build(), [
					activeSchedule.schedule.id,
					pausedSchedule.schedule.id,
					inactiveSchedule.schedule.id,
					absentScheduleId,
				])
			).toEqual([{ schedule: activeRow, workflow: workflowColumnsOf(activeSchedule.schedule) }]);
		}));
});

describe("schedule repository listDueSchedules", () => {
	test("lists active schedules due at the cutoff and skips one due after it", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const now = Date.now();
			const dueAtCutoffSchedule = await withFakeClock(now, () =>
				seedActiveSchedule(deps, { workflowName: "send-invoices", spec: everyMinute })
			);
			await withFakeClock(now + 1, () =>
				seedActiveSchedule(deps, { workflowName: "send-reminders", spec: everyMinute })
			);
			const daemonContext = daemonContextFactory.build();
			const cutoff = (now + ONE_MINUTE) as TimestampMs;

			expect(await repos.schedule.listDueSchedules(daemonContext, cutoff, 10)).toEqual([
				expect.objectContaining({
					schedule: expect.objectContaining({ id: dueAtCutoffSchedule.schedule.id, nextRunAt: cutoff }),
				}),
			]);
			expect(await repos.schedule.listDueSchedules(daemonContext, (cutoff - 1) as TimestampMs, 10)).toEqual([]);
		}));

	const seedScheduleByOtherStatus = {
		paused: seedPausedSchedule,
		inactive: seedInactiveSchedule,
	} satisfies Record<Exclude<ScheduleStatus, "active">, (deps: SeedScheduleDeps) => Promise<{ schedule: Schedule }>>;

	for (const [status, seedSchedule] of Object.entries(seedScheduleByOtherStatus)) {
		test(`does not list a due ${status} schedule`, () =>
			withHarness(async ({ context, repos }) => {
				await seedSchedule({ namespaceRequestContext: context, repos });

				expect(await repos.schedule.listDueSchedules(daemonContextFactory.build(), END_OF_TIME, 10)).toEqual([]);
			}));
	}

	test("lists due schedules by next run time and resumes past a cursor", () =>
		withHarness(async ({ context, repos }) => {
			const deps = { namespaceRequestContext: context, repos };
			const now = Date.now();
			const firstDueSchedule = await withFakeClock(now, () =>
				seedActiveSchedule(deps, { workflowName: "send-invoices", spec: everyMinute })
			);
			const secondDueSchedule = await withFakeClock(now + 1, () =>
				seedActiveSchedule(deps, { workflowName: "send-reminders", spec: everyMinute })
			);
			const thirdDueSchedule = await withFakeClock(now + 2, () =>
				seedActiveSchedule(deps, { workflowName: "archive-orders", spec: everyMinute })
			);
			const daemonContext = daemonContextFactory.build();
			const cutoff = (now + 2 + ONE_MINUTE) as TimestampMs;

			expect(await repos.schedule.listDueSchedules(daemonContext, cutoff, 2)).toEqual([
				expect.objectContaining({
					schedule: expect.objectContaining({ id: firstDueSchedule.schedule.id, nextRunAt: now + ONE_MINUTE }),
				}),
				expect.objectContaining({
					schedule: expect.objectContaining({ id: secondDueSchedule.schedule.id, nextRunAt: now + 1 + ONE_MINUTE }),
				}),
			]);
			expect(
				await repos.schedule.listDueSchedules(daemonContext, cutoff, 2, {
					order: now + 1 + ONE_MINUTE,
					id: secondDueSchedule.schedule.id,
					maxSeenId: secondDueSchedule.schedule.id,
				})
			).toEqual([
				expect.objectContaining({
					schedule: expect.objectContaining({ id: thirdDueSchedule.schedule.id, nextRunAt: now + 2 + ONE_MINUTE }),
				}),
			]);
		}));
});

describe("schedule repository getByIdWithWorkflow", () => {
	test("returns the schedule with its workflow in its namespace and null from another namespace", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ namespaceRequestContext: context, repos });
			const row = await getScheduleRow(repos, context.namespaceId, schedule.id);
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			expect(await repos.schedule.getByIdWithWorkflow(context.namespaceId, schedule.id)).toEqual({
				schedule: row,
				workflow: workflowColumnsOf(schedule),
			});
			expect(await repos.schedule.getByIdWithWorkflow(otherNamespaceId, schedule.id)).toBeNull();
		}));
});

describe("schedule repository getByReferenceIdWithWorkflow", () => {
	test("returns the schedule with its workflow by reference in its namespace and null from another namespace", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule(
				{ namespaceRequestContext: context, repos },
				{ referenceId: "monthly-close" }
			);
			const row = await getScheduleRow(repos, context.namespaceId, schedule.id);
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			expect(await repos.schedule.getByReferenceIdWithWorkflow(context.namespaceId, "monthly-close")).toEqual({
				schedule: row,
				workflow: workflowColumnsOf(schedule),
			});
			expect(await repos.schedule.getByReferenceIdWithWorkflow(otherNamespaceId, "monthly-close")).toBeNull();
		}));
});
