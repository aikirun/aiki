import { asConfigProvider, type ConfigProvider, type CreatePassiveConfigProvider } from "@aikirun/lib/config";
import { merge } from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunRecord } from "@aikirun/types/workflow/run";
import { type AnyWorkflowVersion, executeWorkflowRun, getSystemWorkflows, workflowRegistry } from "@aikirun/workflow";

import { defaultEndpointConfig, type EndpointConfig, type EndpointConfigOverrides } from "./config";
import { verifySignature } from "./signature";

export interface EndpointParams {
	workflows: AnyWorkflowVersion[];
	client: Client;
	secret: string;
	config?: EndpointConfigOverrides | CreatePassiveConfigProvider<EndpointConfig>;
}

export function endpoint(params: EndpointParams): (request: Request) => Promise<Response> {
	const { client, secret } = params;
	const configParam = params.config;

	const registry = workflowRegistry().addMany(getSystemWorkflows(client.api)).addMany(params.workflows);

	const logger = client.logger.child({ "aiki.component": "endpoint" });

	let configProvider: ConfigProvider<EndpointConfig> | undefined;
	const getConfigProvider = (): ConfigProvider<EndpointConfig> => {
		if (!configProvider) {
			if (typeof configParam === "function") {
				configProvider = configParam({ logger: logger.child({ "aiki.component": "config-provider" }) });
			} else {
				const config = merge(defaultEndpointConfig, configParam);
				configProvider = asConfigProvider(() => config);
			}
		}
		return configProvider;
	};

	return async (request: Request): Promise<Response> => {
		const configProvider = getConfigProvider();

		const signatureHeader = request.headers.get("x-aiki-signature");
		if (!signatureHeader) {
			return jsonResponse(401);
		}

		const body = await request.text();

		const valid = await verifySignature({
			header: signatureHeader,
			body,
			secret,
			signatureMaxAgeMs: configProvider.config.signatureMaxAgeMs,
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

		let workflowRun: WorkflowRunRecord | undefined;
		try {
			const response = await client.api.workflowRun.getByIdV1({ id: workflowRunId });
			workflowRun = response.run;
		} catch (err) {
			logger.warn("Failed to fetch workflow run", {
				"aiki.workflowRunId": workflowRunId,
				"aiki.error": err instanceof Error ? err.message : String(err),
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
			configProvider: configProvider.scope("workflowRun"),
		});

		return jsonResponse(success ? 200 : 500);
	};
}

function jsonResponse(status: number): Response {
	return new Response(null, { status });
}
