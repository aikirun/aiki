import type { ApiClient } from "@aikirun/types/client";

import { createCancelChildRunsV1 } from "./cancel-child-runs";
import type { AnyWorkflowVersion } from "../workflow-version";

export function getSystemWorkflows(api: ApiClient): AnyWorkflowVersion[] {
	return [createCancelChildRunsV1(api)];
}
