import type { Logger } from "@aikirun/lib/logger";

import type { IdentityApi } from "./api/identity";
import type { ScheduleApi } from "./api/schedule";
import type { TaskApi } from "./api/task";
import type { WorkflowRunApi } from "./api/workflow-run";
import type { Codec, CreateCodec } from "./infra/codec";
import type { CreateHasher, Hasher } from "./infra/hasher";
import { INTERNAL } from "./symbols";
import type { WorkflowRunRecord } from "./workflow/run";

interface BaseClientParams<Context = null, Encoded = unknown> {
	logger?: Logger;
	context?: (run: Readonly<WorkflowRunRecord>) => Context | Promise<Context>;
	hasher?: CreateHasher;
	codec?: CreateCodec<Encoded>;
}

export interface RemoteClientParams<Context = null, Encoded = unknown> extends BaseClientParams<Context, Encoded> {
	url: string;
	apiKey?: string;
}

export interface EmbeddedClientParams<Context = null, Encoded = unknown> extends BaseClientParams<Context, Encoded> {
	handler: (request: Request) => Promise<Response>;
}

export type ClientParams<Context = null, Encoded = unknown> =
	| RemoteClientParams<Context, Encoded>
	| EmbeddedClientParams<Context, Encoded>;

export interface Client<Context = null> {
	api: ApiClient;
	logger: Logger;
	[INTERNAL]: {
		context?: (run: WorkflowRunRecord) => Context | Promise<Context>;
		hasher?: Hasher;
		codec?: Codec<unknown>;
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
	identity: WithClientOptions<IdentityApi>;
	workflowRun: WithClientOptions<WorkflowRunApi>;
	task: WithClientOptions<TaskApi>;
	schedule: WithClientOptions<ScheduleApi>;
}
