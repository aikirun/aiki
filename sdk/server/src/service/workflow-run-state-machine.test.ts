import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { workflowRunStateByStatus } from "@aikirun/testing/data-factory/workflow/run";
import type { WorkflowRunStateRequest } from "@aikirun/types/api/workflow-run";
import {
	WORKFLOW_RUN_QUEUED_REASON,
	WORKFLOW_RUN_SCHEDULED_REASON,
	WORKFLOW_RUN_STATUSES,
	type WorkflowRunId,
	type WorkflowRunStatus,
} from "@aikirun/types/workflow/run";

import { assertIsValidWorkflowRunStateTransition, convertDurationToTimestamp } from "./workflow-run-state-machine";
import { describe, expect, test } from "bun:test";
import { InvalidWorkflowRunStateTransitionError } from "../errors";

describe("assertIsValidWorkflowRunStateTransition", () => {
	function attemptTransition(fromStatus: WorkflowRunStatus, to: { status: WorkflowRunStatus; reason?: string }): void {
		assertIsValidWorkflowRunStateTransition(
			"run-1" as WorkflowRunId,
			workflowRunStateByStatus[fromStatus],
			to as WorkflowRunStateRequest
		);
	}

	const validTransitions: Record<
		WorkflowRunStatus,
		Partial<Record<WorkflowRunStatus, { reasons?: NonEmptyArray<string> }>>
	> = {
		scheduled: {
			queued: { reasons: ["new", "wakeup_early", "resumption", "event", "child_workflow", "redelivery"] },
			paused: {},
			cancelled: {},
		},
		queued: { running: {}, paused: {}, cancelled: {}, failed: {}, stalled: {} },
		running: {
			queued: { reasons: ["task_retry"] },
			running: {},
			paused: {},
			sleeping: {},
			awaiting_event: {},
			awaiting_retry: {},
			awaiting_child_workflow: {},
			cancelled: {},
			completed: {},
			failed: {},
		},
		paused: { scheduled: { reasons: ["resumption"] }, cancelled: {} },
		sleeping: { scheduled: { reasons: ["wakeup_early"] }, queued: { reasons: ["wakeup"] }, cancelled: {} },
		awaiting_event: { scheduled: { reasons: ["event"] }, queued: { reasons: ["event_wait_timeout"] }, cancelled: {} },
		awaiting_retry: { queued: { reasons: ["retry"] }, cancelled: {} },
		awaiting_child_workflow: {
			scheduled: { reasons: ["child_workflow"] },
			queued: { reasons: ["child_workflow_wait_timeout"] },
			cancelled: {},
		},
		stalled: { scheduled: { reasons: ["redelivery"] }, cancelled: {} },
		cancelled: {},
		completed: {},
		failed: { awaiting_retry: {} },
	};

	const possibleReasons = Array.from(new Set([...WORKFLOW_RUN_SCHEDULED_REASON, ...WORKFLOW_RUN_QUEUED_REASON]));

	for (const fromStatus of WORKFLOW_RUN_STATUSES) {
		describe(`from ${fromStatus}`, () => {
			const validDestinations = validTransitions[fromStatus];

			for (const toStatus of WORKFLOW_RUN_STATUSES) {
				const validDestination = validDestinations[toStatus];

				if (validDestination === undefined) {
					test(`declines to ${toStatus}`, () => {
						expect(() => attemptTransition(fromStatus, { status: toStatus })).toThrow(
							InvalidWorkflowRunStateTransitionError
						);
					});
					continue;
				}

				const validReasons = validDestination?.reasons;
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
				for (const reason of possibleReasons) {
					if (validReasons.includes(reason)) {
						continue;
					}
					test(`declines to ${toStatus} (${reason})`, () => {
						expect(() => attemptTransition(fromStatus, { status: toStatus, reason })).toThrow(
							InvalidWorkflowRunStateTransitionError
						);
					});
				}
			}
		});
	}
});

describe("convertDurationToTimestamp", () => {
	const now = 1_000;

	test("scheduled: scheduledInMs becomes an absolute scheduledAt", () => {
		expect(convertDurationToTimestamp({ status: "scheduled", reason: "event", scheduledInMs: 500 }, now)).toEqual({
			status: "scheduled",
			reason: "event",
			scheduledAt: 1_500,
		});
	});

	test("sleeping: durationMs becomes an absolute wakeupAt", () => {
		expect(convertDurationToTimestamp({ status: "sleeping", sleepName: "nap", durationMs: 500 }, now)).toEqual({
			status: "sleeping",
			sleepName: "nap",
			wakeupAt: 1_500,
		});
	});

	test("awaiting_event with a timeout: timeoutInMs becomes an absolute timeoutAt", () => {
		expect(
			convertDurationToTimestamp({ status: "awaiting_event", eventName: "order-shipped", timeoutInMs: 500 }, now)
		).toEqual({ status: "awaiting_event", eventName: "order-shipped", timeoutAt: 1_500 });
	});

	test("awaiting_event without a timeout: passes through with no timeoutAt", () => {
		expect(convertDurationToTimestamp({ status: "awaiting_event", eventName: "order-shipped" }, now)).toEqual({
			status: "awaiting_event",
			eventName: "order-shipped",
		});
	});

	test("awaiting_retry caused by a task: nextAttemptInMs becomes nextAttemptAt", () => {
		expect(
			convertDurationToTimestamp(
				{ status: "awaiting_retry", cause: "task", taskId: "task-1", nextAttemptInMs: 500 },
				now
			)
		).toEqual({ status: "awaiting_retry", cause: "task", taskId: "task-1", nextAttemptAt: 1_500 });
	});

	test("awaiting_retry caused by a child workflow: nextAttemptInMs becomes nextAttemptAt", () => {
		expect(
			convertDurationToTimestamp(
				{ status: "awaiting_retry", cause: "child_workflow", childWorkflowRunId: "child-1", nextAttemptInMs: 500 },
				now
			)
		).toEqual({
			status: "awaiting_retry",
			cause: "child_workflow",
			childWorkflowRunId: "child-1",
			nextAttemptAt: 1_500,
		});
	});

	test("awaiting_retry caused by self: nextAttemptInMs becomes nextAttemptAt", () => {
		const error = { name: "Error", message: "boom" };
		expect(
			convertDurationToTimestamp({ status: "awaiting_retry", cause: "self", error, nextAttemptInMs: 500 }, now)
		).toEqual({ status: "awaiting_retry", cause: "self", error, nextAttemptAt: 1_500 });
	});

	test("awaiting_child_workflow with a timeout: timeoutInMs becomes an absolute timeoutAt", () => {
		expect(
			convertDurationToTimestamp(
				{
					status: "awaiting_child_workflow",
					childWorkflowRunId: "child-1",
					childWorkflowRunStatus: "completed",
					timeoutInMs: 500,
				},
				now
			)
		).toEqual({
			status: "awaiting_child_workflow",
			childWorkflowRunId: "child-1",
			childWorkflowRunStatus: "completed",
			timeoutAt: 1_500,
		});
	});

	test("awaiting_child_workflow without a timeout: passes through with no timeoutAt", () => {
		expect(
			convertDurationToTimestamp(
				{ status: "awaiting_child_workflow", childWorkflowRunId: "child-1", childWorkflowRunStatus: "completed" },
				now
			)
		).toEqual({
			status: "awaiting_child_workflow",
			childWorkflowRunId: "child-1",
			childWorkflowRunStatus: "completed",
		});
	});

	test("completed with an output: keeps the output", () => {
		expect(convertDurationToTimestamp({ status: "completed", output: { orderId: "order-7" } }, now)).toEqual({
			status: "completed",
			output: { orderId: "order-7" },
		});
	});

	test("completed without an output: normalizes output to undefined", () => {
		expect(convertDurationToTimestamp({ status: "completed" }, now)).toEqual({
			status: "completed",
			output: undefined,
		});
	});

	Object.entries({
		queued: { status: "queued", reason: "new" },
		running: { status: "running" },
		paused: { status: "paused" },
		stalled: { status: "stalled" },
		cancelled: { status: "cancelled" },
		failed: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
	} satisfies {
		[Status in Exclude<
			WorkflowRunStatus,
			"scheduled" | "sleeping" | "awaiting_event" | "awaiting_retry" | "awaiting_child_workflow" | "completed"
		>]: Extract<WorkflowRunStateRequest, { status: Status }>;
	}).forEach(([status, request]) => {
		test(`${status}: carries no duration and passes through unchanged`, () => {
			expect(convertDurationToTimestamp(request, now)).toEqual(request);
		});
	});
});
