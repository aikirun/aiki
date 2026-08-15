import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { NamespaceId } from "@aikirun/types/namespace";

import type { Repositories } from "./types";
import { describe, expect, test } from "bun:test";
import { createServiceHarness } from "../../testing/harness";
import { seedActiveSchedule } from "../../testing/seed/schedule";

const withHarness = createServiceHarness();

async function getScheduleRow(repos: Repositories, namespaceId: NamespaceId, id: string) {
	const schedule = await repos.schedule.get(namespaceId, { id });
	if (!schedule) {
		throw new Error(`Schedule not found: ${id}`);
	}
	return schedule;
}

describe("schedule repository occurrence guard", () => {
	test("bulkUpdateOccurrence leaves the schedule untouched when the expected nextRunAt does not match", () =>
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

	test("bulkUpdateOccurrence advances only the schedules whose expected nextRunAt matches", () =>
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
});
