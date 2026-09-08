import { NotFoundError } from "@aikirun/lib/error";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { ScheduleState, ScheduleStatus } from "@aikirun/types/schedule";

import { transitionScheduleInTx } from "./schedule";
import { describe, expect, test } from "bun:test";
import { InvalidScheduleStateTransitionError } from "../../errors";
import { createServiceHarness } from "../../testing/harness";
import { seedActiveSchedule } from "../../testing/seed/schedule";
import { createScheduleService, type ScheduleService } from "../schedule";

const withHarness = createServiceHarness();

describe("transitionScheduleInTx", () => {
	test("rejects an unknown schedule", () =>
		withHarness(async ({ context, repos }) => {
			expect(
				repos.transaction((txRepos) =>
					transitionScheduleInTx(txRepos, {
						namespaceId: context.namespaceId,
						id: "schedule-missing",
						state: { status: "paused" },
					})
				)
			).rejects.toThrow(NotFoundError);
		}));

	test("does not transition a schedule belonging to another namespace", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const before = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);

			expect(
				repos.transaction((txRepos) =>
					transitionScheduleInTx(txRepos, {
						namespaceId: "other-namespace" as NamespaceId,
						id: schedule.id,
						state: { status: "paused" },
					})
				)
			).rejects.toThrow(NotFoundError);

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(before);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
		}));

	test("writes the new status and points at its transition", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });

			await repos.transaction((txRepos) =>
				transitionScheduleInTx(txRepos, {
					namespaceId: context.namespaceId,
					id: schedule.id,
					state: { status: "paused" },
				})
			);

			const row = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			expect(row).toEqual(expect.objectContaining({ status: "paused", nextRunAt: schedule.nextRunAt }));
			if (!row) {
				throw new Error("Schedule not found");
			}
			expect(await repos.stateTransition.getById(row.latestStateTransitionId)).toEqual(
				expect.objectContaining({ type: "schedule", scheduleId: schedule.id, state: { status: "paused" } })
			);
			const { rows } = await repos.stateTransition.listByScheduleId(schedule.id);
			expect(rows.sort((a, b) => a.status.localeCompare(b.status))).toEqual([
				expect.objectContaining({ state: { status: "active", reason: "activated" } }),
				expect.objectContaining({ state: { status: "paused" } }),
			]);
		}));

	const noOpCases = {
		active: { seed: async () => {}, state: { status: "active", reason: "resumed" } },
		paused: {
			seed: (service, namespaceId, id) => service.pauseSchedule(namespaceId, id),
			state: { status: "paused" },
		},
		inactive: {
			seed: (service, namespaceId, id) => service.deactivateSchedule(namespaceId, id),
			state: { status: "inactive" },
		},
	} satisfies {
		[Status in ScheduleStatus]: {
			seed: (service: ScheduleService, namespaceId: NamespaceId, id: string) => Promise<void>;
			state: Extract<ScheduleState, { status: Status }>;
		};
	};

	for (const [status, { seed, state }] of Object.entries(noOpCases)) {
		test(`leaves an already ${status} schedule and its history untouched`, () =>
			withHarness(async ({ context, repos }) => {
				const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
				await seed(createScheduleService({ repos }), context.namespaceId, schedule.id);
				const before = await repos.schedule.get(context.namespaceId, { id: schedule.id });
				const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);

				await repos.transaction((txRepos) =>
					transitionScheduleInTx(txRepos, {
						namespaceId: context.namespaceId,
						id: schedule.id,
						state,
					})
				);

				expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(before);
				expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
			}));
	}

	test("refuses reactivation of a paused schedule without changing its history", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			await createScheduleService({ repos }).pauseSchedule(context.namespaceId, schedule.id);
			const before = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);

			expect(
				repos.transaction((txRepos) =>
					transitionScheduleInTx(txRepos, {
						namespaceId: context.namespaceId,
						id: schedule.id,
						state: { status: "active", reason: "reactivated" },
					})
				)
			).rejects.toThrow(InvalidScheduleStateTransitionError);

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(before);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
		}));

	test("rolls back the status and pointer when appending history fails", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const before = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			const historyBefore = await repos.stateTransition.listByScheduleId(schedule.id);

			expect(
				repos.transaction((txRepos) =>
					transitionScheduleInTx(
						{
							...txRepos,
							stateTransition: {
								...txRepos.stateTransition,
								append: async () => {
									throw new Error("history unavailable");
								},
							},
						},
						{ namespaceId: context.namespaceId, id: schedule.id, state: { status: "paused" } }
					)
				)
			).rejects.toThrow("history unavailable");

			expect(await repos.schedule.get(context.namespaceId, { id: schedule.id })).toEqual(before);
			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual(historyBefore);
		}));
});
