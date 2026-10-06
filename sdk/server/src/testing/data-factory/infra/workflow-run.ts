import type { RequiredNonNullableProp } from "@aikirun/lib/object";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { Factory } from "fishery";
import { ulid } from "ulidx";

import type { WorkflowRunRowInsert } from "../../../infra/db/types/workflow-run";

export const referencedWorkflowRunRowFactory = Factory.define<
	RequiredNonNullableProp<WorkflowRunRowInsert, "referenceId">
>(() => ({
	id: ulid(),
	namespaceId: ulid(),
	workflowId: ulid(),
	status: "scheduled",
	clientHasherApplied: false,
	clientCodecApplied: false,
	inputHash: "order-7-hash",
	referenceId: "order-7-ref",
	latestStateTransitionId: ulid(),
	scheduledAt: 1_000_000 as TimestampMs,
}));
