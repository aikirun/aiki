import { asNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowName, WorkflowSource, WorkflowVersionId } from "@aikirun/types/workflow";
import { ulid } from "ulidx";

import type { Repositories } from "./types";
import type { WorkflowIdentity } from "./types/workflow";
import { describe, expect, test } from "bun:test";
import { withFakeClock } from "../../testing/clock";
import { daemonContextFactory, namespaceRequestContextFactory } from "../../testing/data-factory/middleware/context";
import { createServiceHarness } from "../../testing/harness";

const withHarness = createServiceHarness();

const sendInvoicesWorkflow = {
	name: "send-invoices" as WorkflowName,
	versionId: "1.0.0" as WorkflowVersionId,
	source: "user" as const,
};
const sendInvoicesWorkflowV2 = { ...sendInvoicesWorkflow, versionId: "2.0.0" as WorkflowVersionId };
const sendInvoicesWorkflowV3 = { ...sendInvoicesWorkflow, versionId: "3.0.0" as WorkflowVersionId };
const reconcileLedgerWorkflow = {
	name: "reconcile-ledger" as WorkflowName,
	versionId: "1.0.0" as WorkflowVersionId,
	source: "user" as const,
};

const ABSENT_WORKFLOW_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

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

/** Inserts a row per identity, minting ids the way the service does. */
async function createWorkflows(repos: Repositories, identities: WorkflowIdentity | NonEmptyArray<WorkflowIdentity>) {
	const rows = (Array.isArray(identities) ? identities : [identities]).map((identity) => ({
		id: ulid(),
		...identity,
	}));
	await repos.workflow.createIfMissing(asNonEmptyArray(rows));
}

/** List reads promise no order, so both sides of a comparison are sorted the same way. */
function orderByIdentity(a: WorkflowIdentity, b: WorkflowIdentity): number {
	return (
		a.namespaceId.localeCompare(b.namespaceId) ||
		a.source.localeCompare(b.source) ||
		a.name.localeCompare(b.name) ||
		a.versionId.localeCompare(b.versionId)
	);
}

describe("workflow repository", () => {
	test("createIfMissing does not change or duplicate a workflow that already exists", () =>
		withHarness(async ({ context, repos }) => {
			const row = { id: ulid(), namespaceId: context.namespaceId, ...sendInvoicesWorkflow };
			await repos.workflow.createIfMissing(row);

			await repos.workflow.createIfMissing({ ...row, id: ulid() });

			expect(await repos.workflow.listByIdentities([row])).toEqual([expect.objectContaining(row)]);
		}));

	test("createIfMissing with many entries creates only the ones that are missing", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			const existingRow = { id: ulid(), namespaceId, ...sendInvoicesWorkflow };
			const missingRow = { id: ulid(), namespaceId, ...sendInvoicesWorkflowV2 };
			await repos.workflow.createIfMissing(existingRow);

			await repos.workflow.createIfMissing([{ ...existingRow, id: ulid() }, missingRow]);

			const rows = await repos.workflow.listByIdentities([existingRow, missingRow]);
			expect([...rows].sort(orderByIdentity)).toEqual([
				expect.objectContaining(existingRow),
				expect.objectContaining(missingRow),
			]);
		}));

	test("listByIdentities returns workflows from any namespace, and a workflow asked for twice comes back once", () =>
		withHarness(async ({ context, repos }) => {
			const inOwnNamespace = { namespaceId: context.namespaceId, ...sendInvoicesWorkflow };
			const inOtherNamespace = {
				namespaceId: namespaceRequestContextFactory.build().namespaceId,
				...sendInvoicesWorkflow,
			};
			await createWorkflows(repos, [inOwnNamespace, inOtherNamespace]);

			const rows = await repos.workflow.listByIdentities([inOwnNamespace, inOtherNamespace, inOwnNamespace]);

			expect([...rows].sort(orderByIdentity)).toEqual(
				[inOwnNamespace, inOtherNamespace].sort(orderByIdentity).map((identity) => expect.objectContaining(identity))
			);
		}));

	test("listByIdentities does not return the same workflow name from another namespace", () =>
		withHarness(async ({ context, repos }) => {
			const inOwnNamespace = { namespaceId: context.namespaceId, ...sendInvoicesWorkflow };
			const inOtherNamespace = {
				namespaceId: namespaceRequestContextFactory.build().namespaceId,
				...sendInvoicesWorkflow,
			};
			await createWorkflows(repos, [inOwnNamespace, inOtherNamespace]);

			expect(await repos.workflow.listByIdentities([inOtherNamespace])).toEqual([
				expect.objectContaining(inOtherNamespace),
			]);
		}));

	test("listByNameAndVersionPairs matches every version of a name when the pair has no version", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...sendInvoicesWorkflowV2 },
				{ namespaceId, ...reconcileLedgerWorkflow },
			]);

			const rows = await repos.workflow.listByNameAndVersionPairs(namespaceId, [
				{ name: "send-invoices", source: "user" },
			]);

			expect([...rows].sort(orderByIdentity)).toEqual([
				expect.objectContaining({ namespaceId, ...sendInvoicesWorkflow }),
				expect.objectContaining({ namespaceId, ...sendInvoicesWorkflowV2 }),
			]);
		}));

	test("listByNameAndVersionPairs matches only the exact version when the pair has one", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...sendInvoicesWorkflowV2 },
				{ namespaceId, ...reconcileLedgerWorkflow },
			]);

			const rows = await repos.workflow.listByNameAndVersionPairs(namespaceId, [
				{ name: "send-invoices", versionId: "2.0.0", source: "user" },
				{ name: "reconcile-ledger", versionId: "1.0.0", source: "user" },
			]);

			expect([...rows].sort(orderByIdentity)).toEqual([
				expect.objectContaining({ namespaceId, ...reconcileLedgerWorkflow }),
				expect.objectContaining({ namespaceId, ...sendInvoicesWorkflowV2 }),
			]);
		}));

	test("getById finds a workflow in its namespace, and returns null from another namespace or for an unknown id", () =>
		withHarness(async ({ context, repos }) => {
			await createWorkflows(repos, { namespaceId: context.namespaceId, ...sendInvoicesWorkflow });
			const row = await getWorkflowRow(repos, context.namespaceId, sendInvoicesWorkflow);
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			expect(await repos.workflow.getById(context.namespaceId, row.id)).toEqual(row);
			expect(await repos.workflow.getById(otherNamespaceId, row.id)).toBeNull();
			expect(await repos.workflow.getById(context.namespaceId, ABSENT_WORKFLOW_ID)).toBeNull();
		}));

	test("getByIds returns rows from any namespace and ignores unknown ids", () =>
		withHarness(async ({ context, repos }) => {
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;
			await createWorkflows(repos, [
				{ namespaceId: context.namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId: otherNamespaceId, ...sendInvoicesWorkflow },
			]);
			const ownNamespaceRow = await getWorkflowRow(repos, context.namespaceId, sendInvoicesWorkflow);
			const otherNamespaceRow = await getWorkflowRow(repos, otherNamespaceId, sendInvoicesWorkflow);

			const rows = await repos.workflow.getByIds(daemonContextFactory.build(), [
				ownNamespaceRow.id,
				otherNamespaceRow.id,
				ABSENT_WORKFLOW_ID,
			]);

			expect([...rows].sort(orderByIdentity)).toEqual([ownNamespaceRow, otherNamespaceRow].sort(orderByIdentity));
		}));

	test("listByNameAndVersion returns every version of a name when no version is given", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...sendInvoicesWorkflowV2 },
				{ namespaceId, ...sendInvoicesWorkflow, source: "system" },
				{ namespaceId: namespaceRequestContextFactory.build().namespaceId, ...sendInvoicesWorkflow },
			]);

			const rows = await repos.workflow.listByNameAndVersion(namespaceId, { name: "send-invoices", source: "user" });

			expect([...rows].sort(orderByIdentity)).toEqual([
				expect.objectContaining({ namespaceId, ...sendInvoicesWorkflow }),
				expect.objectContaining({ namespaceId, ...sendInvoicesWorkflowV2 }),
			]);
		}));

	test("listByNameAndVersion returns only the given version", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...sendInvoicesWorkflowV2 },
			]);

			const rows = await repos.workflow.listByNameAndVersion(namespaceId, {
				name: "send-invoices",
				versionId: "2.0.0",
				source: "user",
			});

			expect(rows).toEqual([expect.objectContaining({ namespaceId, ...sendInvoicesWorkflowV2 })]);
		}));

	test("listByNameAndVersion returns only the requested source", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			const systemSendInvoices = { ...sendInvoicesWorkflow, source: "system" as const };
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...systemSendInvoices },
			]);

			const rows = await repos.workflow.listByNameAndVersion(namespaceId, { name: "send-invoices", source: "system" });

			expect(rows).toEqual([expect.objectContaining({ namespaceId, ...systemSendInvoices })]);
		}));
});

describe("workflow repository listNames", () => {
	test("lists each name once across its versions, A to Z", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...sendInvoicesWorkflowV2 },
				{ namespaceId, ...reconcileLedgerWorkflow },
			]);

			expect(await repos.workflow.listNames(namespaceId, { source: "user" })).toEqual({
				items: [{ name: "reconcile-ledger" }, { name: "send-invoices" }],
				total: 2,
			});
		}));

	test("ignores other namespaces", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId: namespaceRequestContextFactory.build().namespaceId, ...reconcileLedgerWorkflow },
			]);

			expect(await repos.workflow.listNames(namespaceId, { source: "user" })).toEqual({
				items: [{ name: "send-invoices" }],
				total: 1,
			});
		}));

	test("lists only the requested source", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...reconcileLedgerWorkflow, source: "system" },
			]);

			expect(await repos.workflow.listNames(namespaceId, { source: "user" })).toEqual({
				items: [{ name: "send-invoices" }],
				total: 1,
			});
		}));

	test("a name prefix treats an underscore as a literal character", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow, name: "billing_eu" as WorkflowName },
				{ namespaceId, ...sendInvoicesWorkflow, name: "billingXeu" as WorkflowName },
			]);

			expect(await repos.workflow.listNames(namespaceId, { source: "user", namePrefix: "billing_" })).toEqual({
				items: [{ name: "billing_eu" }],
				total: 1,
			});
		}));

	test("a name prefix treats a percent sign as a literal character", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow, name: "billing%eu" as WorkflowName },
				{ namespaceId, ...sendInvoicesWorkflow, name: "billingXeu" as WorkflowName },
			]);

			expect(await repos.workflow.listNames(namespaceId, { source: "user", namePrefix: "billing%" })).toEqual({
				items: [{ name: "billing%eu" }],
				total: 1,
			});
		}));

	test("a name prefix treats a backslash as a literal character", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow, name: "billing\\eu" as WorkflowName },
				{ namespaceId, ...sendInvoicesWorkflow, name: "billingXeu" as WorkflowName },
			]);

			expect(await repos.workflow.listNames(namespaceId, { source: "user", namePrefix: "billing\\" })).toEqual({
				items: [{ name: "billing\\eu" }],
				total: 1,
			});
		}));

	test("pages by limit and offset and still reports the full total", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow, name: "archive-orders" as WorkflowName },
				{ namespaceId, ...reconcileLedgerWorkflow },
				{ namespaceId, ...sendInvoicesWorkflow },
			]);

			expect(await repos.workflow.listNames(namespaceId, { source: "user", limit: 1, offset: 1 })).toEqual({
				items: [{ name: "reconcile-ledger" }],
				total: 3,
			});
		}));
});

describe("workflow repository listVersions", () => {
	test("lists a name's versions newest first", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			const now = Date.now();
			await withFakeClock(now, () => createWorkflows(repos, { namespaceId, ...sendInvoicesWorkflow }));
			await withFakeClock(now + ONE_HOUR, () => createWorkflows(repos, { namespaceId, ...sendInvoicesWorkflowV2 }));
			await createWorkflows(repos, { namespaceId, ...reconcileLedgerWorkflow });

			expect(await repos.workflow.listVersions(namespaceId, { name: "send-invoices", source: "user" })).toEqual({
				items: [{ versionId: "2.0.0" }, { versionId: "1.0.0" }],
				total: 2,
			});
		}));

	test("ignores other namespaces", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId: namespaceRequestContextFactory.build().namespaceId, ...sendInvoicesWorkflowV2 },
			]);

			expect(await repos.workflow.listVersions(namespaceId, { name: "send-invoices", source: "user" })).toEqual({
				items: [{ versionId: "1.0.0" }],
				total: 1,
			});
		}));

	test("lists only the requested source", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			await createWorkflows(repos, [
				{ namespaceId, ...sendInvoicesWorkflow },
				{ namespaceId, ...sendInvoicesWorkflowV2, source: "system" },
			]);

			expect(await repos.workflow.listVersions(namespaceId, { name: "send-invoices", source: "user" })).toEqual({
				items: [{ versionId: "1.0.0" }],
				total: 1,
			});
		}));

	test("pages by limit and offset and still reports the full total", () =>
		withHarness(async ({ context, repos }) => {
			const namespaceId = context.namespaceId;
			const now = Date.now();
			await withFakeClock(now, () => createWorkflows(repos, { namespaceId, ...sendInvoicesWorkflow }));
			await withFakeClock(now + ONE_HOUR, () => createWorkflows(repos, { namespaceId, ...sendInvoicesWorkflowV2 }));
			await withFakeClock(now + 2 * ONE_HOUR, () => createWorkflows(repos, { namespaceId, ...sendInvoicesWorkflowV3 }));

			expect(
				await repos.workflow.listVersions(namespaceId, { name: "send-invoices", source: "user", limit: 1, offset: 1 })
			).toEqual({
				items: [{ versionId: "2.0.0" }],
				total: 3,
			});
		}));
});
