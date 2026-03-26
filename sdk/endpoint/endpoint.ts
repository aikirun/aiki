import type { Client } from "@aikirun/types/client";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow-run";
import {
	type AnyWorkflowVersion,
	executeWorkflowRun,
	getSystemWorkflows,
	type WorkflowExecutionOptions,
	workflowRegistry,
} from "@aikirun/workflow";

import { verifySignature } from "./signature";

export interface EndpointParams {
	workflows: AnyWorkflowVersion[];
	client: Client;
	secret: string;
	options?: EndpointOptions;
}

export interface EndpointOptions {
	signatureMaxAgeMs?: number;
	workflowRun?: WorkflowExecutionOptions;
}

export function endpoint(params: EndpointParams): (request: Request) => Promise<Response> {
	const { client, secret, options } = params;
	const signatureMaxAgeMs = options?.signatureMaxAgeMs ?? 30_000;
	const workflowRunOptions = {
		heartbeatIntervalMs: options?.workflowRun?.heartbeatIntervalMs ?? 30_000,
		spinThresholdMs: options?.workflowRun?.spinThresholdMs ?? 10,
	};

	const registry = workflowRegistry().addMany(getSystemWorkflows(client.api)).addMany(params.workflows);

	const logger = client.logger.child({ "aiki.component": "endpoint" });

	return async (request: Request): Promise<Response> => {
		const signatureHeader = request.headers.get("x-aiki-signature");
		if (!signatureHeader) {
			return jsonResponse(401);
		}

		const body = await request.text();

		const valid = await verifySignature({
			header: signatureHeader,
			body,
			secret,
			signatureMaxAgeMs,
		});
		if (!valid) {
			return jsonResponse(401);
		}

		let workflowRunId: string | undefined;
		try {
			const parsedBody = JSON.parse(body);
			workflowRunId = parsedBody.workflowRunId;
			if (typeof workflowRunId !== "string" || workflowRunId === "") {
				return jsonResponse(400);
			}
		} catch {
			return jsonResponse(400);
		}

		let workflowRun: WorkflowRun | undefined;
		try {
			const response = await client.api.workflowRun.getByIdV1({ id: workflowRunId });
			workflowRun = response.run;
		} catch (error) {
			logger.warn("Failed to fetch workflow run", {
				"aiki.workflowRunId": workflowRunId,
				"aiki.error": error instanceof Error ? error.message : String(error),
			});
			return jsonResponse(404);
		}

		const runLogger = logger.child({
			"aiki.workflowName": workflowRun.name,
			"aiki.workflowVersionId": workflowRun.versionId,
			"aiki.workflowRunId": workflowRun.id,
		});

		const workflowVersion = registry.get(workflowRun.name as WorkflowName, workflowRun.versionId as WorkflowVersionId);
		if (!workflowVersion) {
			runLogger.warn("Workflow version not found");
			return jsonResponse(404);
		}

		const success = await executeWorkflowRun({
			client,
			workflowRun,
			workflowVersion,
			logger: runLogger,
			options: {
				spinThresholdMs: workflowRunOptions.spinThresholdMs,
				heartbeatIntervalMs: workflowRunOptions.heartbeatIntervalMs,
			},
			heartbeat: () => client.api.workflowRun.heartbeatV1({ id: workflowRun.id as WorkflowRunId }),
		});

		return jsonResponse(success ? 200 : 500);
	};
}

function jsonResponse(status: number): Response {
	return new Response(null, { status });
}
