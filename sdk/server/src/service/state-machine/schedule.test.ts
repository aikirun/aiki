import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import {
	SCHEDULE_ACTIVE_REASONS,
	SCHEDULE_STATUSES,
	type ScheduleActiveReason,
	type ScheduleState,
	type ScheduleStatus,
} from "@aikirun/types/schedule";

import { assertIsValidScheduleStateTransition } from "./schedule";
import { describe, expect, test } from "bun:test";
import { InvalidScheduleStateTransitionError } from "../../errors";

describe("assertIsValidScheduleStateTransition", () => {
	function attemptTransition(
		fromStatus: ScheduleStatus,
		to: { status: ScheduleStatus; reason?: ScheduleActiveReason }
	): void {
		assertIsValidScheduleStateTransition("schedule-1", fromStatus, to as ScheduleState);
	}

	const validTransitions: Record<
		ScheduleStatus,
		Partial<Record<ScheduleStatus, { reasons?: NonEmptyArray<ScheduleActiveReason> }>>
	> = {
		active: { paused: {}, inactive: {} },
		paused: { active: { reasons: ["resumed"] }, inactive: {} },
		inactive: { active: { reasons: ["reactivated"] } },
	};

	for (const fromStatus of SCHEDULE_STATUSES) {
		describe(`from ${fromStatus}`, () => {
			const validDestinations = validTransitions[fromStatus];

			for (const toStatus of SCHEDULE_STATUSES) {
				const validDestination = validDestinations[toStatus];

				if (validDestination === undefined) {
					test(`declines to ${toStatus}`, () => {
						expect(() => attemptTransition(fromStatus, { status: toStatus })).toThrow(
							InvalidScheduleStateTransitionError
						);
					});
					continue;
				}

				const validReasons = validDestination.reasons;
				if (validReasons === undefined) {
					test(`accepts to ${toStatus}`, () => {
						expect(() => attemptTransition(fromStatus, { status: toStatus })).not.toThrow();
					});
					continue;
				}

				for (const reason of validReasons) {
					test(`accepts to ${toStatus} (${reason})`, () => {
						expect(() => attemptTransition(fromStatus, { status: toStatus, reason })).not.toThrow();
					});
				}
				for (const reason of SCHEDULE_ACTIVE_REASONS) {
					if (validReasons.includes(reason)) {
						continue;
					}
					test(`declines to ${toStatus} (${reason})`, () => {
						expect(() => attemptTransition(fromStatus, { status: toStatus, reason })).toThrow(
							InvalidScheduleStateTransitionError
						);
					});
				}
			}
		});
	}
});
