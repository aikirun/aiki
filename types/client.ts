import type { ScheduleApi } from "@aikirun/types/schedule-api";
import type { WorkflowRun } from "@aikirun/types/workflow-run";
import type { WorkflowRunApi } from "@aikirun/types/workflow-run-api";

import type { Logger } from "./logger";
import { INTERNAL } from "./symbols";

export interface ClientParams<AppContext = null> {
	url: string;
	apiKey: string;
	logger?: Logger;
	createContext?: (run: Readonly<WorkflowRun>) => AppContext | Promise<AppContext>;
}

export interface Client<AppContext = null> {
	api: ApiClient;
	logger: Logger;
	[INTERNAL]: {
		createContext?: (run: WorkflowRun) => AppContext | Promise<AppContext>;
	};
}

/**
 * Wraps each method of an API contract with an additional `{ signal }` option,
 * reflecting orpc's runtime client behaviour. Lets callers cancel in-flight
 * requests without polluting the wire contract types.
 */
type WithClientOptions<T> = {
	[K in keyof T]: T[K] extends (input: infer I) => Promise<infer O>
		? (input: I, options?: { signal?: AbortSignal }) => Promise<O>
		: T[K];
};

export interface ApiClient {
	workflowRun: WithClientOptions<WorkflowRunApi>;
	schedule: WithClientOptions<ScheduleApi>;
}
