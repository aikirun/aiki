import type { FakePublisher } from "@aikirun/testing/infra/queue";

import { type SeedRunDeps, seedClaimedRun } from "./run";
import { createTaskStateMachineService } from "../../service/task-state-machine";
import { namespaceRequestContextFactory } from "../data-factory/middleware/context";

const seededTask = { name: "reserve-inventory", input: { sku: "SKU-42", quantity: 3 } } as const;

export async function seedRunningTask(deps: SeedRunDeps & { publisher: FakePublisher }) {
	const { repos } = deps;
	const namespaceRequestContext = deps.namespaceRequestContext ?? namespaceRequestContextFactory.build();
	const seeded = await seedClaimedRun({ ...deps, namespaceRequestContext });

	const taskStateMachine = createTaskStateMachineService({ repos });
	const taskInfo = await taskStateMachine.transitionState(namespaceRequestContext, {
		type: "create",
		id: seeded.runId,
		expectedWorkflowRunRevision: seeded.revisionWhenClaimed,
		taskName: seededTask.name,
		input: seededTask.input,
		taskState: { status: "running" },
	});

	return { ...seeded, taskInfo, taskInput: seededTask.input };
}
