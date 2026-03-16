import type { ApiClient } from "@aikirun/types/client";

import { createCancelChildRunsV1 } from "./cancel-child-runs";
import type { WorkflowVersion } from "../workflow-version";

// biome-ignore lint/suspicious/noExplicitAny: any workflow
export function getSystemWorkflows(api: ApiClient): WorkflowVersion<any, any, any, any>[] {
	return [createCancelChildRunsV1(api)];
}
