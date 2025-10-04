import { initWorkflowRunRepository, type WorkflowRunRepository } from "../workflow/run/repository.ts";
import {
	resolveSubscriberStrategy,
	type SubscriberStrategy,
	type SubscriberStrategyBuilder,
} from "./subscribers/strategy-resolver.ts";
import type { WorkflowName } from "../workflow/workflow.ts";
import { Redis } from "redis";

export async function client(params: ClientParams): Promise<Client> {
	const workflowRunRepository = await initWorkflowRunRepository();
	return Promise.resolve(new ClientImpl(workflowRunRepository, params));
}

export interface RedisConfig {
	host: string;
	port: number;
	password?: string;
	db?: number;
	maxRetriesPerRequest?: number;
	retryDelayOnFailoverMs?: number;
	connectTimeoutMs?: number;
}

export interface ClientParams {
	serverUrl: string;
	redisStreams?: RedisConfig;
}

export interface Client {
	workflowRunRepository: WorkflowRunRepository;
	getServerUrl: () => string;
	_internal: {
		subscriber: {
			create: (
				strategy: SubscriberStrategy,
				workflowNames: WorkflowName[],
				workerShards?: string[],
			) => SubscriberStrategyBuilder;
		};
		redisStreams: {
			getConnection: () => Redis;
			closeConnection: () => Promise<void>;
		};
	};
}

class ClientImpl implements Client {
	public readonly _internal: Client["_internal"];
	private redisStreamsConnection?: Redis;

	constructor(
		public readonly workflowRunRepository: WorkflowRunRepository,
		private readonly params: ClientParams,
	) {
		this._internal = {
			subscriber: {
				create: (strategy, workflowNames, workerShards) =>
					resolveSubscriberStrategy(this, strategy, workflowNames, workerShards),
			},
			redisStreams: {
				getConnection: () => this.getRedisStreamsConnection(),
				closeConnection: () => this.closeRedisStreamsConnection(),
			},
		};
	}

	public getServerUrl(): string {
		return this.params.serverUrl;
	}

	private getRedisStreamsConnection(): Redis {
		if (!this.redisStreamsConnection) {
			if (!this.params.redisStreams) {
				throw new Error(
					"Redis Streams configuration not provided to client. Add 'redisStreams' to ClientParams.",
				);
			}
			this.redisStreamsConnection = new Redis(this.params.redisStreams);
		}
		return this.redisStreamsConnection;
	}

	private async closeRedisStreamsConnection(): Promise<void> {
		if (this.redisStreamsConnection) {
			await this.redisStreamsConnection.quit();
			this.redisStreamsConnection = undefined;
		}
	}
}
