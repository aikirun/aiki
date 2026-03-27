import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

function createTestDb() {
	const raw = new Database(":memory:");
	raw.exec("PRAGMA foreign_keys = ON");

	raw.exec(
		`CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "name" TEXT, "email" TEXT NOT NULL UNIQUE, "email_verified" INTEGER NOT NULL DEFAULT 0, "image" TEXT, "status" TEXT NOT NULL DEFAULT 'active', "created_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)), "updated_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)))`
	);

	raw.exec(
		`CREATE TABLE "organization" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL UNIQUE, "logo" TEXT, "metadata" TEXT, "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'active', "created_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)), "updated_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)))`
	);

	raw.exec(
		`CREATE TABLE "namespace" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "organization_id" TEXT NOT NULL REFERENCES "organization"("id"), "status" TEXT NOT NULL DEFAULT 'active', "created_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)), "updated_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)))`
	);

	raw.exec(
		`CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "token" TEXT NOT NULL UNIQUE, "expires_at" INTEGER NOT NULL, "ip_address" TEXT, "user_agent" TEXT, "active_organization_id" TEXT, "active_namespace_id" TEXT, "created_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)), "updated_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)))`
	);

	raw.exec(
		`CREATE TABLE "organization_invitation" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL, "inviter_id" TEXT NOT NULL REFERENCES "user"("id"), "organization_id" TEXT NOT NULL REFERENCES "organization"("id"), "role" TEXT NOT NULL, "status" TEXT NOT NULL, "namespace_id" TEXT, "expires_at" INTEGER NOT NULL, "created_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)), "updated_at" INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer)))`
	);
	raw.exec(
		`CREATE UNIQUE INDEX "uqidx_org_invitation_pending_email_org_namespace" ON "organization_invitation" ("email", "organization_id", "namespace_id") WHERE "status" = 'pending'`
	);

	raw.exec(
		`CREATE TABLE "workflow" ("id" TEXT PRIMARY KEY, "namespace_id" TEXT NOT NULL REFERENCES "namespace"("id"), "source" TEXT NOT NULL DEFAULT 'user', "name" TEXT NOT NULL, "version_id" TEXT NOT NULL, "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`
	);

	raw.exec(
		`CREATE TABLE "schedule" ("id" TEXT PRIMARY KEY, "namespace_id" TEXT NOT NULL, "workflow_id" TEXT NOT NULL REFERENCES "workflow"("id"), "status" TEXT NOT NULL, "type" TEXT NOT NULL, "cron_expression" TEXT, "interval_ms" INTEGER, "overlap_policy" TEXT, "workflow_run_input" TEXT, "workflow_run_input_hash" TEXT NOT NULL, "definition_hash" TEXT NOT NULL, "reference_id" TEXT, "conflict_policy" TEXT, "last_occurrence" TEXT, "next_run_at" TEXT, "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`
	);

	raw.exec(
		`CREATE TABLE "workflow_run" ("id" TEXT PRIMARY KEY, "namespace_id" TEXT NOT NULL, "workflow_id" TEXT NOT NULL REFERENCES "workflow"("id"), "schedule_id" TEXT REFERENCES "schedule"("id"), "parent_workflow_run_id" TEXT REFERENCES "workflow_run"("id"), "status" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0, "attempts" INTEGER NOT NULL DEFAULT 0, "input" TEXT, "input_hash" TEXT NOT NULL, "options" TEXT, "reference_id" TEXT, "conflict_policy" TEXT, "latest_state_transition_id" TEXT NOT NULL, "scheduled_at" TEXT, "awake_at" TEXT, "timeout_at" TEXT, "next_attempt_at" TEXT, "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`
	);

	raw.exec(
		`CREATE TABLE "task" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "workflow_run_id" TEXT NOT NULL REFERENCES "workflow_run"("id"), "status" TEXT NOT NULL, "attempts" INTEGER NOT NULL, "input" TEXT, "input_hash" TEXT NOT NULL, "options" TEXT, "latest_state_transition_id" TEXT NOT NULL, "next_attempt_at" TEXT, "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`
	);

	raw.exec(`CREATE TABLE "state_transition" (
		"id" TEXT PRIMARY KEY,
		"workflow_run_id" TEXT NOT NULL REFERENCES "workflow_run"("id"),
		"type" TEXT NOT NULL,
		"task_id" TEXT REFERENCES "task"("id"),
		"status" TEXT NOT NULL,
		"attempt" INTEGER NOT NULL,
		"state" TEXT NOT NULL,
		"created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		CHECK ((type = 'task' AND task_id IS NOT NULL) OR (type = 'workflow_run' AND task_id IS NULL)),
		CHECK ((type = 'workflow_run' AND status IN ('scheduled', 'queued', 'running', 'paused', 'sleeping', 'awaiting_event', 'awaiting_retry', 'awaiting_child_workflow', 'cancelled', 'completed', 'failed')) OR (type = 'task' AND status IN ('running', 'awaiting_retry', 'completed', 'failed')))
	)`);

	raw.exec(`CREATE TABLE "sleep_queue" (
		"id" TEXT PRIMARY KEY,
		"workflow_run_id" TEXT NOT NULL REFERENCES "workflow_run"("id"),
		"name" TEXT NOT NULL,
		"status" TEXT NOT NULL,
		"awake_at" TEXT NOT NULL,
		"completed_at" TEXT,
		"cancelled_at" TEXT,
		"created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		CHECK (status != 'completed' OR completed_at IS NOT NULL),
		CHECK (status != 'cancelled' OR cancelled_at IS NOT NULL)
	)`);
	raw.exec(
		`CREATE UNIQUE INDEX "uqidx_sleep_queue_one_active_per_run" ON "sleep_queue" ("workflow_run_id") WHERE "status" = 'sleeping'`
	);

	return { raw, close: () => raw.close() };
}

function seedPrerequisites(raw: Database) {
	raw.exec(`INSERT INTO "user" ("id", "email") VALUES ('u1', 'u1@test.com')`);
	raw.exec(`INSERT INTO "organization" ("id", "name", "slug", "type") VALUES ('org1', 'Org', 'org1', 'personal')`);
	raw.exec(`INSERT INTO "namespace" ("id", "name", "organization_id") VALUES ('ns1', 'default', 'org1')`);
	raw.exec(
		`INSERT INTO "workflow" ("id", "namespace_id", "name", "version_id") VALUES ('wf1', 'ns1', 'test-wf', 'v1')`
	);
	raw.exec(
		`INSERT INTO "workflow_run" ("id", "namespace_id", "workflow_id", "status", "input_hash", "latest_state_transition_id") VALUES ('wr1', 'ns1', 'wf1', 'running', 'h1', 'st-placeholder')`
	);
	raw.exec(
		`INSERT INTO "task" ("id", "name", "workflow_run_id", "status", "attempts", "input_hash", "latest_state_transition_id") VALUES ('t1', 'my-task', 'wr1', 'running', 1, 'h1', 'st-placeholder')`
	);
}

describe("schema constraints", () => {
	let raw: Database;

	beforeAll(() => {
		const db = createTestDb();
		raw = db.raw;
		seedPrerequisites(raw);
	});

	afterAll(() => {
		raw.close();
	});

	describe("CHECK: state transition status matches type", () => {
		it("accepts valid workflow_run status", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "state_transition" ("id", "workflow_run_id", "type", "task_id", "status", "attempt", "state") VALUES ('st-wr-ok', 'wr1', 'workflow_run', NULL, 'running', 1, '{}')`
				);
			}).not.toThrow();
		});

		it("rejects invalid workflow_run status", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "state_transition" ("id", "workflow_run_id", "type", "task_id", "status", "attempt", "state") VALUES ('st-wr-bad', 'wr1', 'workflow_run', NULL, 'bogus', 1, '{}')`
				);
			}).toThrow();
		});

		it("accepts valid task status", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "state_transition" ("id", "workflow_run_id", "type", "task_id", "status", "attempt", "state") VALUES ('st-task-ok', 'wr1', 'task', 't1', 'completed', 1, '{}')`
				);
			}).not.toThrow();
		});

		it("rejects workflow_run-only status for task type", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "state_transition" ("id", "workflow_run_id", "type", "task_id", "status", "attempt", "state") VALUES ('st-task-bad', 'wr1', 'task', 't1', 'sleeping', 1, '{}')`
				);
			}).toThrow();
		});
	});

	describe("CHECK: task state transition requires task_id", () => {
		it("rejects type=task with null task_id", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "state_transition" ("id", "workflow_run_id", "type", "task_id", "status", "attempt", "state") VALUES ('st-no-tid', 'wr1', 'task', NULL, 'running', 1, '{}')`
				);
			}).toThrow();
		});

		it("accepts type=task with a valid task_id", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "state_transition" ("id", "workflow_run_id", "type", "task_id", "status", "attempt", "state") VALUES ('st-tid-ok', 'wr1', 'task', 't1', 'running', 1, '{}')`
				);
			}).not.toThrow();
		});

		it("rejects type=workflow_run with a non-null task_id", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "state_transition" ("id", "workflow_run_id", "type", "task_id", "status", "attempt", "state") VALUES ('st-wr-tid', 'wr1', 'workflow_run', 't1', 'running', 1, '{}')`
				);
			}).toThrow();
		});
	});

	describe("partial unique index: sleep queue one active per run", () => {
		it("rejects two sleeping entries for the same workflow_run", () => {
			raw.exec(
				`INSERT INTO "sleep_queue" ("id", "workflow_run_id", "name", "status", "awake_at") VALUES ('sq1', 'wr1', 'sleep-a', 'sleeping', '2025-01-01T00:00:00.000Z')`
			);
			expect(() => {
				raw.exec(
					`INSERT INTO "sleep_queue" ("id", "workflow_run_id", "name", "status", "awake_at") VALUES ('sq2', 'wr1', 'sleep-b', 'sleeping', '2025-01-02T00:00:00.000Z')`
				);
			}).toThrow();
		});

		it("allows sleeping + completed for the same workflow_run", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "sleep_queue" ("id", "workflow_run_id", "name", "status", "awake_at", "completed_at") VALUES ('sq3', 'wr1', 'sleep-c', 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:01:00.000Z')`
				);
			}).not.toThrow();
		});
	});

	describe("partial unique index: org invitation pending", () => {
		it("rejects duplicate pending invitations for same email+org+namespace", () => {
			raw.exec(
				`INSERT INTO "organization_invitation" ("id", "email", "inviter_id", "organization_id", "role", "status", "namespace_id", "expires_at") VALUES ('inv1', 'a@test.com', 'u1', 'org1', 'member', 'pending', 'ns1', 9999999999)`
			);
			expect(() => {
				raw.exec(
					`INSERT INTO "organization_invitation" ("id", "email", "inviter_id", "organization_id", "role", "status", "namespace_id", "expires_at") VALUES ('inv2', 'a@test.com', 'u1', 'org1', 'member', 'pending', 'ns1', 9999999999)`
				);
			}).toThrow();
		});

		it("allows pending + accepted for same email+org+namespace", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "organization_invitation" ("id", "email", "inviter_id", "organization_id", "role", "status", "namespace_id", "expires_at") VALUES ('inv3', 'a@test.com', 'u1', 'org1', 'member', 'accepted', 'ns1', 9999999999)`
				);
			}).not.toThrow();
		});
	});

	describe("ON DELETE CASCADE", () => {
		it("deletes sessions when the referenced user is deleted", () => {
			raw.exec(`INSERT INTO "user" ("id", "email") VALUES ('u-cascade', 'cascade@test.com')`);
			raw.exec(
				`INSERT INTO "session" ("id", "user_id", "token", "expires_at") VALUES ('s-cascade', 'u-cascade', 'tok-cascade', 9999999999)`
			);

			const before = raw.query(`SELECT * FROM "session" WHERE "id" = 's-cascade'`).all();
			expect(before).toHaveLength(1);

			raw.exec(`DELETE FROM "user" WHERE "id" = 'u-cascade'`);

			const after = raw.query(`SELECT * FROM "session" WHERE "id" = 's-cascade'`).all();
			expect(after).toHaveLength(0);
		});
	});

	describe("foreign key enforcement", () => {
		it("rejects a session referencing a non-existent user", () => {
			expect(() => {
				raw.exec(
					`INSERT INTO "session" ("id", "user_id", "token", "expires_at") VALUES ('s-bad', 'no-such-user', 'tok-bad', 9999999999)`
				);
			}).toThrow();
		});
	});
});
