import { asNonEmptyArray, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import { nestedMap } from "@aikirun/lib/collection/map";
import type { WorkflowListRequestV1, WorkflowListVersionsRequestV1 } from "@aikirun/types/api/workflow";
import type { NamespaceId } from "@aikirun/types/namespace";
import { ulid } from "ulidx";

import type { Repositories, TxRepositories } from "../infra/db/types";
import type { WorkflowIdentity, WorkflowRow } from "../infra/db/types/workflow";
import type { NamespaceRequestContext } from "../middleware/context";

export interface WorkflowServiceDeps {
	repos: Repositories;
}

export const createWorkflowService = ({ repos }: WorkflowServiceDeps) => ({
	async listWorkflows(context: NamespaceRequestContext, request: WorkflowListRequestV1) {
		const { items, total } = await repos.workflow.listNames(context.namespaceId, request);
		return {
			workflows: items.map((item) => ({ name: item.name, source: request.source })),
			total,
		};
	},

	async listWorkflowVersions(context: NamespaceRequestContext, request: WorkflowListVersionsRequestV1) {
		const { items, total } = await repos.workflow.listVersions(context.namespaceId, request);
		return { versions: items, total };
	},
});

export type WorkflowService = ReturnType<typeof createWorkflowService>;

export async function getOrCreateWorkflowInTx(
	identity: WorkflowIdentity,
	txRepos: TxRepositories
): Promise<WorkflowRow> {
	// Creating a run must not lock the workflow row, or every concurrent create of the same workflow
	// waits on it. So the row is read, and only a miss inserts.
	const existing = await txRepos.workflow.getByNameAndVersion(identity.namespaceId as NamespaceId, identity);
	if (existing) {
		return existing;
	}

	await txRepos.workflow.createIfMissing({ id: ulid(), ...identity });

	const created = await txRepos.workflow.getByNameAndVersion(identity.namespaceId as NamespaceId, identity);
	if (!created) {
		throw new Error(`Failed to get or create workflow ${identity.source}:${identity.name}:${identity.versionId}`);
	}
	return created;
}

export async function bulkGetOrCreateWorkflowsInTx(
	identities: NonEmptyArray<WorkflowIdentity>,
	txRepos: TxRepositories
): Promise<WorkflowRow[]> {
	const existing = await txRepos.workflow.listByIdentities(identities);

	// Nested key by identity part rather than joined into one key string, otherwise a single joined key
	// can collide when name/version contain the separator.
	// e.g.
	// name - billing:v2  version - 1.0.0     →  billing:v2:1.0.0
	// name - billing     version - v2:1.0.0  →  billing:v2:1.0.0
	const existingByIdentity = nestedMap(existing, "namespaceId", "source", "name", "versionId");
	const missing = identities.filter(
		({ namespaceId, source, name, versionId }) =>
			!existingByIdentity.get(namespaceId)?.get(source)?.get(name)?.has(versionId)
	);
	if (!isNonEmptyArray(missing)) {
		return existing;
	}

	const rows = missing.map((identity) => ({ id: ulid(), ...identity }));
	await txRepos.workflow.createIfMissing(asNonEmptyArray(rows));
	return txRepos.workflow.listByIdentities(identities);
}
