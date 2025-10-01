import type { MaybeField } from "@lib/object/mod.ts";
import type { TriggerStrategy } from "@lib/trigger/mod.ts";
import type { WorkflowRun } from "@aiki/sdk/workflow";

export interface WorkflowRunContext<Payload, Result> {
	workflowRun: Omit<WorkflowRun<Payload, Result>, "params">;
}

export type WorkflowRunParams<Payload> = MaybeField<"payload", Payload> & {
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
	/**
	 * Optional shard key for distributing workflows across sharded streams.
	 * When provided, the workflow will be routed to stream: workflow:${workflowName}:${shard}
	 * When omitted, the workflow uses the default stream: workflow:${workflowName}
	 */
	shard?: string;
};
