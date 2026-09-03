import type { Logger } from "@aikirun/lib/logger";

import type { ScheduleApi } from "./api/schedule";
import type { TaskApi } from "./api/task";
import type { WorkflowRunApi } from "./api/workflow-run";
import type { Codec, CreateCodec } from "./infra/codec";
import type { CreateHasher, Hasher } from "./infra/hasher";
import { INTERNAL } from "./symbols";
import type { WorkflowRunRecord } from "./workflow/run";

interface BaseClientParams<Context = null> {
	logger?: Logger;
	context?: (run: Readonly<WorkflowRunRecord>) => Context | Promise<Context>;
	hasher?: CreateHasher;
	codec?: CreateCodec;
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
		hasher: Hasher;
		codec?: Codec;
	};
}

/**
 * Wraps each method of an API contract with an additional `{ signal }` option,
 * reflecting orpc's runtime client behaviour. Lets callers cancel in-flight
 * requests without polluting the wire contract types.
 */
type WithClientOptions<T> = {
	[K in keyof T]: T[K] extends (input: infer Input) => Promise<infer Output>
		? (input: Input, options?: { signal?: AbortSignal }) => Promise<Output>
		: T[K];
};

export interface ApiClient {
	workflowRun: WithClientOptions<WorkflowRunApi>;
	task: WithClientOptions<TaskApi>;
	schedule: WithClientOptions<ScheduleApi>;
}
