import { describe, expect, test } from "bun:test";
import { createServiceHarness } from "../../testing/harness";
import { seedCompletedRun } from "../../testing/seed/run";

const withHarness = createServiceHarness();

describe("workflow run repository state reads", () => {
	test("getByIdWithWorkflowAndState returns a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedCompletedRun(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined }
			);

			const row = await repos.workflowRun.getByIdWithWorkflowAndState({ namespaceId: context.namespaceId, id: runId });

			expect(row?.state).toContainKey("output");
			expect(row?.state).toEqual({ status: "completed", output: { encodedValue: undefined } });
		}));

	test("getByIdWithState returns a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedCompletedRun(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined }
			);

			const row = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });

			expect(row?.state).toContainKey("output");
			expect(row?.state).toEqual({ status: "completed", output: { encodedValue: undefined } });
		}));

	test("getByReferenceWithWorkflowAndState returns a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const referenceId = "order-7-ref";
			const { workflowName, workflowVersionId, workflowSource } = await seedCompletedRun(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined, options: { reference: { id: referenceId } } }
			);

			const row = await repos.workflowRun.getByReferenceWithWorkflowAndState({
				namespaceId: context.namespaceId,
				name: workflowName,
				versionId: workflowVersionId,
				source: workflowSource,
				referenceId,
			});

			expect(row?.state).toContainKey("output");
			expect(row?.state).toEqual({ status: "completed", output: { encodedValue: undefined } });
		}));
});
