import type { Logger } from "@aikirun/lib/logger";

import type { ScheduleApi } from "./api/schedule";
import type { WorkflowRunApi } from "./api/workflow-run";
import { INTERNAL } from "./symbols";
import type { WorkflowRunRecord } from "./workflow/run";

interface BaseClientParams<Context = null> {
	logger?: Logger;
	context?: (run: Readonly<WorkflowRunRecord>) => Context | Promise<Context>;
}

export interface RemoteClientParams<Context = null> extends BaseClientParams<Context> {
	url: string;
	apiKey?: string;
}

export interface EmbeddedClientParams<Context = null> extends BaseClientParams<Context> {
	handler: (request: Request) => Promise<Response>;
}

export type ClientParams<Context = null> = RemoteClientParams<Context> | EmbeddedClientParams<Context>;

export interface Client<Context = null> {
	api: ApiClient;
	logger: Logger;
	[INTERNAL]: {
		context?: (run: WorkflowRunRecord) => Context | Promise<Context>;
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
