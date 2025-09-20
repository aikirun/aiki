import { initWorkflowRunRepository, type WorkflowRunRepository } from "../workflow/run/repository.ts";
import { initWorkflowRunSubscriber, type WorkflowRunSubscriber } from "../workflow/run/subscriber.ts";

export async function createClient(params: ClientParams): Promise<Client> {
	const workflowRunRepository = await initWorkflowRunRepository();
	return Promise.resolve(new ClientImpl(workflowRunRepository, params));
}

export interface ClientParams {
	serverUrl: string;
}

export interface Client {
	workflowRunRepository: WorkflowRunRepository;
	getWorkflowRunSubscriber: () => Promise<WorkflowRunSubscriber>;
	getServerUrl: () => string;
}

class ClientImpl implements Client {
	private workflowRunSubscriber: WorkflowRunSubscriber | undefined;

	// TODO: params is unused
	constructor(
		public readonly workflowRunRepository: WorkflowRunRepository,
		private readonly params: ClientParams,
	) {}

	public async getWorkflowRunSubscriber(): Promise<WorkflowRunSubscriber> {
		if (this.workflowRunSubscriber === undefined) {
			this.workflowRunSubscriber = await initWorkflowRunSubscriber({
				repository: this.workflowRunRepository,
			});
		}
		return this.workflowRunSubscriber;
	}

	public getServerUrl(): string {
		return this.params.serverUrl;
	}
}
