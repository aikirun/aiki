import type { ScheduleApi } from "@aikirun/types/schedule-api";
import type { WorkflowRun } from "@aikirun/types/workflow-run";
import type { WorkflowRunApi } from "@aikirun/types/workflow-run-api";

import type { Logger } from "./logger";
import { INTERNAL } from "./symbols";

export interface ClientParams<AppContext = unknown> {
	url: string;
	apiKey?: string;
	logger?: Logger;
	createContext?: (run: Readonly<WorkflowRun>) => AppContext | Promise<AppContext>;
}

export interface Client<AppContext = unknown> {
	api: ApiClient;
	logger: Logger;
	[INTERNAL]: {
		createContext?: (run: WorkflowRun) => AppContext | Promise<AppContext>;
	};
}

export interface ApiClient {
	workflowRun: WorkflowRunApi;
	schedule: ScheduleApi;
}
