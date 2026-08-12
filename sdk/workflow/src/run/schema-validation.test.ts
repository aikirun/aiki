import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/data-factory/workflow/run";
import { WorkflowRunFailedError } from "@aikirun/types/workflow/run";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import { workflowRunHandle } from "./handle";
import { validateWithSchema } from "./schema-validation";
import { describe, expect, test } from "bun:test";

describe("validateWithSchema", () => {
	test("returns a sync validator's value directly, without wrapping it in a promise", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build();
			const handle = workflowRunHandle(client, record);
			const toUpperCase: StandardSchemaV1<string> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: (value) => ({ value: String(value).toUpperCase() }),
				},
			};

			const result = validateWithSchema(handle, toUpperCase, "lagos", client.logger, "Invalid test data");

			expect(result instanceof Promise).toBe(false);
			expect(result).toBe("LAGOS");
		}));

	test("fails the run with cause self and throws WorkflowRunFailedError when a sync validator rejects", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build();
			const handle = workflowRunHandle(client, record);
			const alwaysInvalid: StandardSchemaV1<string> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: () => ({ issues: [{ message: "invalid data" }] }),
				},
			};

			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: {
						status: "failed",
						cause: "self",
						error: {
							name: "SchemaValidationError",
							message: JSON.stringify([{ message: "invalid data" }]),
						},
					},
					expectedRevision: record.revision,
				},
				{ revision: record.revision, state: record.state, attempts: record.attempts }
			);

			expect(
				validateWithSchema(handle, alwaysInvalid, "anything", client.logger, "Invalid test data")
			).rejects.toBeInstanceOf(WorkflowRunFailedError);
		}));

	test("resolves an async validator's value", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build();
			const handle = workflowRunHandle(client, record);
			const toUpperCaseAsync: StandardSchemaV1<string> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: async (value) => ({ value: String(value).toUpperCase() }),
				},
			};

			expect(await validateWithSchema(handle, toUpperCaseAsync, "lagos", client.logger, "Invalid test data")).toBe(
				"LAGOS"
			);
		}));

	test("fails the run with cause self and throws WorkflowRunFailedError when an async validator rejects", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build();
			const handle = workflowRunHandle(client, record);
			const alwaysInvalidAsync: StandardSchemaV1<string> = {
				"~standard": {
					version: 1,
					vendor: "test",
					validate: async () => ({ issues: [{ message: "invalid data" }] }),
				},
			};

			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: {
						status: "failed",
						cause: "self",
						error: {
							name: "SchemaValidationError",
							message: JSON.stringify([{ message: "invalid data" }]),
						},
					},
					expectedRevision: record.revision,
				},
				{ revision: record.revision, state: record.state, attempts: record.attempts }
			);

			expect(
				validateWithSchema(handle, alwaysInvalidAsync, "anything", client.logger, "Invalid test data")
			).rejects.toBeInstanceOf(WorkflowRunFailedError);
		}));
});
