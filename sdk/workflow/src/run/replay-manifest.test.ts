import { childWorkflowRunInfoFactory, runningWorkflowRunRecordFactory } from "@aikirun/testing/workflow/run";
import { completedTaskInfoFactory } from "@aikirun/testing/workflow/task";
import type { WorkflowRunAddress } from "@aikirun/types/workflow/run";
import type { TaskAddress } from "@aikirun/types/workflow/task";

import { createReplayManifest } from "./replay-manifest";
import { describe, expect, test } from "bun:test";

const taskAddressA = "task-addr-a" as TaskAddress;
const taskAddressB = "task-addr-b" as TaskAddress;
const childRunAddressA = "child-addr-a" as WorkflowRunAddress;
const childRunAddressB = "child-addr-b" as WorkflowRunAddress;

describe("createReplayManifest", () => {
	describe("consumeNextTask", () => {
		test("returns the tasks for an address in order", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: {
						[taskAddressA]: {
							tasks: [completedTaskInfoFactory.build({ id: "t1" }), completedTaskInfoFactory.build({ id: "t2" })],
						},
					},
				})
			);

			expect(manifest.consumeNextTask(taskAddressA)?.id).toBe("t1");
			expect(manifest.consumeNextTask(taskAddressA)?.id).toBe("t2");
		});

		test("returns the complete task info", () => {
			const task = completedTaskInfoFactory.build({ id: "t1" });
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({ taskQueues: { [taskAddressA]: { tasks: [task] } } })
			);

			expect(manifest.consumeNextTask(taskAddressA)).toEqual(task);
		});

		test("returns undefined once an address is exhausted", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: { [taskAddressA]: { tasks: [completedTaskInfoFactory.build()] } },
				})
			);

			manifest.consumeNextTask(taskAddressA);
			expect(manifest.consumeNextTask(taskAddressA)).toBeUndefined();
		});

		test("returns undefined for an unknown address", () => {
			const manifest = createReplayManifest(runningWorkflowRunRecordFactory.build());

			expect(manifest.consumeNextTask(taskAddressA)).toBeUndefined();
		});

		test("tracks a separate cursor per address", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: {
						[taskAddressA]: {
							tasks: [completedTaskInfoFactory.build({ id: "a1" }), completedTaskInfoFactory.build({ id: "a2" })],
						},
						[taskAddressB]: { tasks: [completedTaskInfoFactory.build({ id: "b1" })] },
					},
				})
			);

			expect(manifest.consumeNextTask(taskAddressA)?.id).toBe("a1");
			expect(manifest.consumeNextTask(taskAddressB)?.id).toBe("b1");
			expect(manifest.consumeNextTask(taskAddressA)?.id).toBe("a2");
			expect(manifest.consumeNextTask(taskAddressB)).toBeUndefined();
		});
	});

	describe("consumeNextChildWorkflowRun", () => {
		test("returns the child runs for an address in order", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: {
						[childRunAddressA]: {
							childWorkflowRuns: [
								childWorkflowRunInfoFactory.build({ id: "c1" }),
								childWorkflowRunInfoFactory.build({ id: "c2" }),
							],
						},
					},
				})
			);

			expect(manifest.consumeNextChildWorkflowRun(childRunAddressA)?.id).toBe("c1");
			expect(manifest.consumeNextChildWorkflowRun(childRunAddressA)?.id).toBe("c2");
		});

		test("returns the complete child run info", () => {
			const childRun = childWorkflowRunInfoFactory.build({ id: "c1" });
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: { [childRunAddressA]: { childWorkflowRuns: [childRun] } },
				})
			);

			expect(manifest.consumeNextChildWorkflowRun(childRunAddressA)).toEqual(childRun);
		});

		test("returns undefined once an address is exhausted", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: { [childRunAddressA]: { childWorkflowRuns: [childWorkflowRunInfoFactory.build()] } },
				})
			);

			manifest.consumeNextChildWorkflowRun(childRunAddressA);
			expect(manifest.consumeNextChildWorkflowRun(childRunAddressA)).toBeUndefined();
		});

		test("returns undefined for an unknown address", () => {
			const manifest = createReplayManifest(runningWorkflowRunRecordFactory.build());

			expect(manifest.consumeNextChildWorkflowRun(childRunAddressA)).toBeUndefined();
		});

		test("tracks a separate cursor per address", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: {
						[childRunAddressA]: {
							childWorkflowRuns: [
								childWorkflowRunInfoFactory.build({ id: "a1" }),
								childWorkflowRunInfoFactory.build({ id: "a2" }),
							],
						},
						[childRunAddressB]: { childWorkflowRuns: [childWorkflowRunInfoFactory.build({ id: "b1" })] },
					},
				})
			);

			expect(manifest.consumeNextChildWorkflowRun(childRunAddressA)?.id).toBe("a1");
			expect(manifest.consumeNextChildWorkflowRun(childRunAddressB)?.id).toBe("b1");
			expect(manifest.consumeNextChildWorkflowRun(childRunAddressA)?.id).toBe("a2");
			expect(manifest.consumeNextChildWorkflowRun(childRunAddressB)).toBeUndefined();
		});
	});

	describe("hasUnconsumedEntries", () => {
		test("is false for an empty manifest", () => {
			const manifest = createReplayManifest(runningWorkflowRunRecordFactory.build());

			expect(manifest.hasUnconsumedEntries()).toBe(false);
		});

		test("is true while tasks remain and false once consumed", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: { [taskAddressA]: { tasks: [completedTaskInfoFactory.build()] } },
				})
			);

			expect(manifest.hasUnconsumedEntries()).toBe(true);
			manifest.consumeNextTask(taskAddressA);
			expect(manifest.hasUnconsumedEntries()).toBe(false);
		});

		test("is true while child runs remain and false once consumed", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: { [childRunAddressA]: { childWorkflowRuns: [childWorkflowRunInfoFactory.build()] } },
				})
			);

			expect(manifest.hasUnconsumedEntries()).toBe(true);
			manifest.consumeNextChildWorkflowRun(childRunAddressA);
			expect(manifest.hasUnconsumedEntries()).toBe(false);
		});

		test("stays true until both tasks and child runs are consumed", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: { [taskAddressA]: { tasks: [completedTaskInfoFactory.build()] } },
					childWorkflowRunQueues: { [childRunAddressA]: { childWorkflowRuns: [childWorkflowRunInfoFactory.build()] } },
				})
			);

			expect(manifest.hasUnconsumedEntries()).toBe(true);
			manifest.consumeNextTask(taskAddressA);
			expect(manifest.hasUnconsumedEntries()).toBe(true);
			manifest.consumeNextChildWorkflowRun(childRunAddressA);
			expect(manifest.hasUnconsumedEntries()).toBe(false);
		});
	});

	describe("getUnconsumedEntries", () => {
		test("lists all task and child run ids initially", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: {
						[taskAddressA]: {
							tasks: [completedTaskInfoFactory.build({ id: "t1" }), completedTaskInfoFactory.build({ id: "t2" })],
						},
						[taskAddressB]: { tasks: [completedTaskInfoFactory.build({ id: "t3" })] },
					},
					childWorkflowRunQueues: {
						[childRunAddressA]: { childWorkflowRuns: [childWorkflowRunInfoFactory.build({ id: "c1" })] },
					},
				})
			);

			expect(manifest.getUnconsumedEntries()).toEqual({
				taskIds: ["t1", "t2", "t3"],
				childWorkflowRunIds: ["c1"],
			});
		});

		test("omits consumed tasks across addresses", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: {
						[taskAddressA]: {
							tasks: [completedTaskInfoFactory.build({ id: "t1" }), completedTaskInfoFactory.build({ id: "t2" })],
						},
						[taskAddressB]: { tasks: [completedTaskInfoFactory.build({ id: "t3" })] },
					},
				})
			);

			manifest.consumeNextTask(taskAddressA);

			expect(manifest.getUnconsumedEntries()).toEqual({
				taskIds: ["t2", "t3"],
				childWorkflowRunIds: [],
			});
		});

		test("omits consumed child runs", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					childWorkflowRunQueues: {
						[childRunAddressA]: {
							childWorkflowRuns: [
								childWorkflowRunInfoFactory.build({ id: "c1" }),
								childWorkflowRunInfoFactory.build({ id: "c2" }),
							],
						},
					},
				})
			);

			manifest.consumeNextChildWorkflowRun(childRunAddressA);

			expect(manifest.getUnconsumedEntries()).toEqual({
				taskIds: [],
				childWorkflowRunIds: ["c2"],
			});
		});

		test("is empty after full consumption", () => {
			const manifest = createReplayManifest(
				runningWorkflowRunRecordFactory.build({
					taskQueues: { [taskAddressA]: { tasks: [completedTaskInfoFactory.build({ id: "t1" })] } },
					childWorkflowRunQueues: {
						[childRunAddressA]: { childWorkflowRuns: [childWorkflowRunInfoFactory.build({ id: "c1" })] },
					},
				})
			);

			manifest.consumeNextTask(taskAddressA);
			manifest.consumeNextChildWorkflowRun(childRunAddressA);

			expect(manifest.getUnconsumedEntries()).toEqual({
				taskIds: [],
				childWorkflowRunIds: [],
			});
		});
	});
});
