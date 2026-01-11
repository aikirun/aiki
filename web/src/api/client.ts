import type { WorkflowApi } from "@aikirun/types/workflow-api";
import type { WorkflowRunApi } from "@aikirun/types/workflow-run-api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

const API_URL = import.meta.env.VITE_AIKI_SERVER_URL || "http://localhost:9876";
const rpcLink = new RPCLink({ url: API_URL });

export const client = createORPCClient(rpcLink) as unknown as {
	workflow: WorkflowApi;
	workflowRun: WorkflowRunApi;
};
