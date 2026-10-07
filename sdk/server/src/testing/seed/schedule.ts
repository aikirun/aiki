import { hashInput } from "@aikirun/lib/crypto";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { Schedule, ScheduleSpec } from "@aikirun/types/schedule";

import { defaultServerRuntimeConfig } from "../../config/runtime";
import { processImminentRecurringRuns } from "../../daemon/imminent-recurring-runs";
import type { Repositories } from "../../infra/db/types";
import type { DaemonContext, NamespaceRequestContext } from "../../middleware/context";
import { createChildRunCanceller } from "../../service/cancel-child-runs";
import { createScheduleService } from "../../service/schedule";
import { withFakeClock } from "../clock";
import { daemonContextFactory, namespaceRequestContextFactory } from "../data-factory/middleware/context";

const seededSchedule = {
	workflowName: "send-invoices",
	workflowVersionId: "v1",
	workflowRunInput: { region: "eu-west" },
	spec: { type: "interval", everyMs: 60_000 },
} as const;

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

export interface SeedScheduleDeps {
	repos: Repositories;
	namespaceRequestContext?: NamespaceRequestContext;
}

export interface SeedScheduleOverrides {
	workflowName?: string;
	workflowVersionId?: string;
	spec?: ScheduleSpec;
	referenceId?: string;
}

export async function seedActiveSchedule(deps: SeedScheduleDeps, overrides?: SeedScheduleOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();

	const scheduleService = createScheduleService({ repos });
	const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
		...seededSchedule,
		workflowName: overrides?.workflowName ?? seededSchedule.workflowName,
		workflowVersionId: overrides?.workflowVersionId ?? seededSchedule.workflowVersionId,
		spec: overrides?.spec ?? seededSchedule.spec,
		workflowRunInput: asOpaquePayload(seededSchedule.workflowRunInput),
		workflowRunInputHash: { value: await hashInput(seededSchedule.workflowRunInput) },
		clientHasherApplied: false,
		clientCodecApplied: false,
		options: overrides?.referenceId === undefined ? undefined : { reference: { id: overrides.referenceId } },
	});

	return { schedule };
}

export async function seedPausedSchedule(deps: SeedScheduleDeps, overrides?: SeedScheduleOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext }, overrides);

	const scheduleService = createScheduleService({ repos });
	await scheduleService.pauseSchedule(namespaceRequestContext.namespaceId, schedule.id);

	return { schedule };
}

export async function seedInactiveSchedule(deps: SeedScheduleDeps, overrides?: SeedScheduleOverrides) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext }, overrides);

	const scheduleService = createScheduleService({ repos });
	await scheduleService.deactivateSchedule(namespaceRequestContext.namespaceId, schedule.id);

	return { schedule };
}

/** The run the schedule's next occurrence creates, promoted the way the recurring-runs daemon does. */
export async function seedRunFromSchedule(
	deps: { repos: Repositories; daemonContext?: DaemonContext; namespaceRequestContext?: NamespaceRequestContext },
	params: { schedule: Schedule }
) {
	const { repos } = deps;
	const daemonContext = deps.daemonContext ?? daemonContextFactory.build();
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();

	await withFakeClock(params.schedule.nextRunAt, () =>
		processImminentRecurringRuns(
			daemonContext,
			{ repos, childRunCanceller: createChildRunCanceller() },
			{
				pageSize: 100,
				lookaheadWindowMs: 0,
				overshootMs: 0,
				maxOccurrencesPerSchedule: 1,
				republishBackoff,
				chunk: { size: 100, maxConcurrency: 10 },
			}
		)
	);

	const { rows } = await repos.workflowRun.listByFilters(
		{ namespaceId: namespaceRequestContext.namespaceId, scheduleId: params.schedule.id },
		2,
		0,
		{ order: "asc" }
	);
	const run = rows[0];
	if (!run || rows.length !== 1) {
		throw new Error(`Expected one run created from schedule ${params.schedule.id}, found ${rows.length}`);
	}

	return { runId: run.id };
}
