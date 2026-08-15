import type { Repositories } from "../../infra/db/types";
import type { NamespaceRequestContext } from "../../middleware/context";
import { createScheduleService } from "../../service/schedule";
import { namespaceRequestContextFactory } from "../data-factory/middleware/context";

const seededSchedule = {
	workflowName: "send-invoices",
	workflowVersionId: "v1",
	workflowRunInput: { region: "eu-west" },
	spec: { type: "interval", everyMs: 60_000 },
} as const;

export async function seedActiveSchedule(
	deps: { repos: Repositories; namespaceRequestContext?: NamespaceRequestContext },
	overrides?: { workflowName?: string }
) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();

	const scheduleService = createScheduleService({ repos });
	const { schedule } = await scheduleService.activateSchedule(namespaceRequestContext.namespaceId, {
		...seededSchedule,
		workflowName: overrides?.workflowName ?? seededSchedule.workflowName,
	});

	return { schedule };
}
