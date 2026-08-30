import { hashInput } from "@aikirun/lib/crypto";

import { processImminentRecurringRuns } from "./imminent-recurring-runs";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createScheduleService } from "../service/schedule";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentRecurringRuns", () => {
	test("the occurrence's outbox rank carries the schedule's run priority", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleService = createScheduleService({ repos });
			const workflowRunInput = { region: "eu-west" };

			const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
				workflowName: "send-invoices",
				workflowVersionId: "v1",
				workflowRunInput,
				workflowRunInputHash: { value: await hashInput(workflowRunInput) },
				spec: { type: "interval", everyMs: 60_000, overlapPolicy: "skip" },
				workflowRunOptions: { priority: 2 },
			});
			const { createdAt } = schedule;
			expect(createdAt).toBeGreaterThan(0);

			await withFakeClock(createdAt + 120_000, () =>
				processImminentRecurringRuns(
					context,
					{ repos, childRunCanceller: createChildRunCanceller() },
					{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
				)
			);

			// computeRank(occurrence, priority 2) = occurrence * 10 + 2.
			expect(await repos.workflowRunOutbox.listPending(context, 100)).toEqual([
				expect.objectContaining({
					workflowName: "send-invoices",
					status: "pending",
					rank: (createdAt + 120_000) * 10 + 2,
					nextPublishAttemptRank: (createdAt + 120_000) * 10 + 2,
				}),
			]);
		}));
});
