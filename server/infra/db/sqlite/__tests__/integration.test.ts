import type { NamespaceId } from "@aikirun/types/namespace";

import { afterAll, describe, expect, it } from "bun:test";
import { createSqliteRepositories } from "..";
import { createSqliteDatabase } from "../provider";
import * as schema from "../schema";

describe("sqlite integration", () => {
	const { raw, conn, close } = createSqliteDatabase({ provider: "sqlite", path: ":memory:" });
	const repos = createSqliteRepositories(conn, raw);

	afterAll(() => close());

	it("full lifecycle: namespace -> workflow -> run -> state transition -> query", async () => {
		// 1. Insert prerequisite auth data directly
		await conn.insert(schema.user).values({
			id: "user-1",
			email: "test@test.com",
			name: "Test",
		});
		await conn.insert(schema.organization).values({
			id: "org-1",
			name: "Test Org",
			slug: "test-org",
			type: "personal",
		});

		// 2. Create namespace via repo
		const ns = await repos.namespace.create({
			id: "ns-1",
			name: "default",
			organizationId: "org-1",
		});
		expect(ns.id).toBe("ns-1");
		expect(ns.name).toBe("default");

		// 3. Create workflow via repo
		const wf = await repos.workflow.getOrCreate({
			namespaceId: "ns-1",
			name: "my-workflow",
			versionId: "v1",
			source: "user",
		});
		expect(wf.name).toBe("my-workflow");
		expect(wf.versionId).toBe("v1");

		// 4. Insert workflow run and state transition in a transaction
		const stId = "st-001";
		const initialState = {
			status: "scheduled" as const,
			reason: "new" as const,
			scheduledAt: Date.now(),
		};
		await repos.transaction(async (tx) => {
			await tx.workflowRun.insert({
				id: "run-1",
				namespaceId: "ns-1",
				workflowId: wf.id,
				status: "scheduled",
				inputHash: "abc123",
				latestStateTransitionId: stId,
				referenceId: "ref-1",
			});
			await tx.stateTransition.appendBatch([
				{
					id: stId,
					workflowRunId: "run-1",
					type: "workflow_run",
					taskId: null,
					status: "scheduled",
					attempt: 0,
					state: initialState,
				},
			]);
		});

		// 6. Query the workflow run with state
		const runWithState = await repos.workflowRun.getByIdWithState("ns-1" as NamespaceId, "run-1");
		expect(runWithState).not.toBeNull();
		expect(runWithState?.id).toBe("run-1");
		expect(runWithState?.status).toBe("scheduled");
		expect(runWithState?.state.status).toBe("scheduled");
		expect(runWithState?.revision).toBe(0);
		expect(runWithState?.attempts).toBe(0);
		expect(runWithState?.latestStateTransitionId).toBe(stId);

		// 7. Verify close works without errors
		close();
	});
});
