import type { ScheduleApi } from "@aikirun/types/schedule-api";
import type { WorkflowRun } from "@aikirun/types/workflow-run";
import type { WorkflowRunApi } from "@aikirun/types/workflow-run-api";

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

export interface Logger {
	trace(message: string, metadata?: Record<string, unknown>): void;
	debug(message: string, metadata?: Record<string, unknown>): void;
	info(message: string, metadata?: Record<string, unknown>): void;
	warn(message: string, metadata?: Record<string, unknown>): void;
	error(message: string, metadata?: Record<string, unknown>): void;
	child(bindings: Record<string, unknown>): Logger;
}

export interface ApiClient {
	workflowRun: WorkflowRunApi;
	schedule: ScheduleApi;
}
