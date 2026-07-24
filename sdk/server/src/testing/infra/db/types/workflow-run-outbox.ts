import { Factory } from "fishery";
import { ulid } from "ulidx";

import type { WorkflowRunOutboxRowInsertPending } from "../../../../infra/db/types/workflow-run-outbox";

export const pendingWorkflowRunOutboxRowFactory = Factory.define<WorkflowRunOutboxRowInsertPending>(() => ({
	id: ulid(),
	namespaceId: "ns",
	workflowRunId: ulid(),
	workflowName: "sync-inventory",
	workflowVersionId: "v1",
	rank: 1,
	status: "pending",
}));
