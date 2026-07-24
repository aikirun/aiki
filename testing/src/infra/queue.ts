import type { ReadyWorkflowRun } from "@aikirun/types/infra/queue";
import { Factory } from "fishery";

export const readyWorkflowRunFactory = Factory.define<ReadyWorkflowRun>(({ sequence }) => ({
	namespaceId: "ns",
	id: `run-${sequence}`,
	name: "sync-inventory",
	versionId: "v1",
	rank: 1,
}));
