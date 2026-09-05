import { createBinaryLatch } from "@aikirun/lib/async";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowName, WorkflowSource, WorkflowVersionId } from "@aikirun/types/workflow";

import { bulkGetOrCreateWorkflowsInTx, createWorkflowService, getOrCreateWorkflowInTx } from "./workflow";
import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import type { WorkflowIdentity, WorkflowRow } from "../infra/db/types/workflow";
import { withFakeClock } from "../testing/clock";
import { createServiceHarness, withRepos } from "../testing/harness";

const withHarness = createServiceHarness();

const sendInvoicesWorkflow = {
	name: "send-invoices" as WorkflowName,
	versionId: "1.0.0" as WorkflowVersionId,
	source: "user" as const,
};
const sendInvoicesWorkflowV2 = { ...sendInvoicesWorkflow, versionId: "2.0.0" as WorkflowVersionId };
const reconcileLedgerWorkflow = {
	name: "reconcile-ledger" as WorkflowName,
	versionId: "1.0.0" as WorkflowVersionId,
	source: "user" as const,
};

const ONE_HOUR = 60 * 60 * 1_000;

/** Reads a row back for the value only the database assigns: its id. */
async function getWorkflowRow(
	repos: Repositories,
	namespaceId: NamespaceId,
	workflow: { name: string; versionId: string; source: WorkflowSource }
) {
	const row = await repos.workflow.getByNameAndVersion(namespaceId, workflow);
	if (!row) {
		throw new Error(`Workflow not found: ${workflow.source}:${workflow.name}:${workflow.versionId}`);
	}
	return row;
}

/** Creates the workflow row the way a run or schedule creation does. */
function createWorkflow(repos: Repositories, identity: WorkflowIdentity) {
	return repos.transaction((txRepos) => getOrCreateWorkflowInTx(identity, txRepos));
}

describe("getOrCreateWorkflowInTx", () => {
	test("creates the workflow when it does not exist", () =>
		withHarness(async ({ context, repos }) => {
			const entry = { namespaceId: context.namespaceId, ...sendInvoicesWorkflow };

			const created = await createWorkflow(repos, entry);

			expect(created).toEqual(expect.objectContaining(entry));
			expect(await repos.workflow.getByNameAndVersion(context.namespaceId, sendInvoicesWorkflow)).toEqual(created);
		}));

	test("returns the existing row on a second call without creating another", () =>
		withHarness(async ({ context, repos }) => {
			const entry = { namespaceId: context.namespaceId, ...sendInvoicesWorkflow };

			const first = await createWorkflow(repos, entry);
			const second = await createWorkflow(repos, entry);

			expect(second).toEqual(first);
			expect(await repos.workflow.listByIdentities([entry])).toEqual([first]);
		}));

	test("two transactions creating the same workflow at once both get the one row", () =>
		withHarness(async ({ context, repos: primaryRepos }) =>
			withRepos(async (secondaryRepos) => {
				const entry = { namespaceId: context.namespaceId, ...sendInvoicesWorkflow };

				const primaryCreated = createBinaryLatch();
				const commitPrimaryTx = createBinaryLatch();

				// The primary creates, signals, then holds its transaction open: row written, uncommitted.
				const primaryPromise = primaryRepos.transaction(async (txRepos) => {
					const row = await getOrCreateWorkflowInTx(entry, txRepos);
					primaryCreated.signal();
					await commitPrimaryTx.wait();
					return row;
				});
				await primaryCreated.wait();

				// Dispatched while the primary is still open, deliberately not awaited yet. Whether its
				// read runs before or after the commit, it must end up with the primary's row.
				const secondaryPromise = createWorkflow(secondaryRepos, entry);

				commitPrimaryTx.signal();
				const primaryRow = await primaryPromise;
				const secondaryRow = await secondaryPromise;

				expect(secondaryRow).toEqual(primaryRow);
				expect(await primaryRepos.workflow.listByIdentities([entry])).toEqual([primaryRow]);
			})
		));
});

describe("bulkGetOrCreateWorkflowsInTx", () => {
	const orderById = (a: WorkflowRow, b: WorkflowRow) => a.id.localeCompare(b.id);

	test("returns a row for every entry, keeping the ones that already exist", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			const existingEntry = { namespaceId, ...sendInvoicesWorkflow };
			const missingEntry = { namespaceId, ...sendInvoicesWorkflowV2 };
			const existing = await createWorkflow(repos, existingEntry);

			const rows = await repos.transaction((txRepos) =>
				bulkGetOrCreateWorkflowsInTx([existingEntry, missingEntry], txRepos)
			);

			const created = await getWorkflowRow(repos, namespaceId, sendInvoicesWorkflowV2);
			expect([...rows].sort(orderById)).toEqual([existing, created].sort(orderById));
		}));

	test("returns the existing rows when every entry already exists", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			const created = await repos.transaction((txRepos) =>
				bulkGetOrCreateWorkflowsInTx(
					[
						{ namespaceId, ...sendInvoicesWorkflow },
						{ namespaceId, ...sendInvoicesWorkflowV2 },
					],
					txRepos
				)
			);

			const rows = await repos.transaction((txRepos) =>
				bulkGetOrCreateWorkflowsInTx(
					[
						{ namespaceId, ...sendInvoicesWorkflow },
						{ namespaceId, ...sendInvoicesWorkflowV2 },
					],
					txRepos
				)
			);

			expect([...rows].sort(orderById)).toEqual([...created].sort(orderById));
		}));

	test("does not confuse name 'billing:v2' version '1.0.0' with name 'billing' version 'v2:1.0.0'", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			// Joining the identity parts into one string would read these two as the same workflow.
			const colonInName = {
				namespaceId,
				source: "user" as const,
				name: "billing:v2" as WorkflowName,
				versionId: "1.0.0" as WorkflowVersionId,
			};
			const colonInVersion = {
				namespaceId,
				source: "user" as const,
				name: "billing" as WorkflowName,
				versionId: "v2:1.0.0" as WorkflowVersionId,
			};
			const existing = await createWorkflow(repos, colonInName);

			const rows = await repos.transaction((txRepos) =>
				bulkGetOrCreateWorkflowsInTx([colonInName, colonInVersion], txRepos)
			);

			const created = await getWorkflowRow(repos, namespaceId, colonInVersion);
			expect([...rows].sort(orderById)).toEqual([existing, created].sort(orderById));
		}));
});

describe("workflow service", () => {
	test("listWorkflows reports each name once, with the requested source", () =>
		withHarness(async ({ context, repos }) => {
			const service = createWorkflowService({ repos });
			const namespaceId = context.namespaceId;
			await createWorkflow(repos, { namespaceId, ...sendInvoicesWorkflow });
			await createWorkflow(repos, { namespaceId, ...sendInvoicesWorkflowV2 });
			await createWorkflow(repos, { namespaceId, ...reconcileLedgerWorkflow });

			expect(await service.listWorkflows(context, { source: "user" })).toEqual({
				workflows: [
					{ name: "reconcile-ledger", source: "user" },
					{ name: "send-invoices", source: "user" },
				],
				total: 2,
			});
		}));

	test("listWorkflowVersions lists a name's versions newest first", () =>
		withHarness(async ({ context, repos }) => {
			const service = createWorkflowService({ repos });
			const namespaceId = context.namespaceId;
			const now = Date.now();
			await withFakeClock(now, () => createWorkflow(repos, { namespaceId, ...sendInvoicesWorkflow }));
			await withFakeClock(now + ONE_HOUR, () => createWorkflow(repos, { namespaceId, ...sendInvoicesWorkflowV2 }));

			expect(await service.listWorkflowVersions(context, { name: "send-invoices", source: "user" })).toEqual({
				versions: [{ versionId: "2.0.0" }, { versionId: "1.0.0" }],
				total: 2,
			});
		}));
});
