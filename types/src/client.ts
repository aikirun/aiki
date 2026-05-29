import type { Logger } from "@aikirun/lib/logger";

import type { ScheduleApi } from "./api/schedule";
import type { WorkflowRunApi } from "./api/workflow-run";
import { INTERNAL } from "./symbols";
import type { WorkflowRunRecord } from "./workflow/run";

interface BaseClientParams<AppContext = null> {
	logger?: Logger;
	appContext?: (run: Readonly<WorkflowRunRecord>) => AppContext | Promise<AppContext>;
}

export interface RemoteClientParams<AppContext = null> extends BaseClientParams<AppContext> {
	url: string;
	apiKey?: string;
}

export interface EmbeddedClientParams<AppContext = null> extends BaseClientParams<AppContext> {
	handler: (request: Request) => Promise<Response>;
}

export type ClientParams<AppContext = null> = RemoteClientParams<AppContext> | EmbeddedClientParams<AppContext>;

export interface Client<AppContext = null> {
	api: ApiClient;
	logger: Logger;
	[INTERNAL]: {
		appContext?: (run: WorkflowRunRecord) => AppContext | Promise<AppContext>;
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
