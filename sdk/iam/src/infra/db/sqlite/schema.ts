import type { TimestampMs } from "@aikirun/lib/timestamp";
import { NAMESPACE_ROLES } from "@aikirun/types/namespace";
import { type SQL, sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	type SQLiteColumn,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { timestampMs } from "./timestamp";
import { API_KEY_STATUSES } from "../constants/api-key";
import { NAMESPACE_STATUSES } from "../constants/namespace";
import {
	ORGANIZATION_INVITATION_STATUSES,
	ORGANIZATION_ROLES,
	ORGANIZATION_STATUSES,
	ORGANIZATION_TYPES,
} from "../constants/organization";
import { USER_STATUSES } from "../constants/user";

const NOW_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

const boolean = (name: string) => integer(name, { mode: "boolean" });

// The update statement sets updated_at: a trigger runs only after the update, too late for
// RETURNING to see it. SQLite runs in this process, so this is the clock the created_at default reads.
const updatedAtMs = () =>
	timestampMs("updated_at")
		.notNull()
		.default(NOW_MS)
		.$onUpdate(() => Date.now() as TimestampMs);

// SQLite has no enum type, so each enum column carries a CHECK of its values.
function isOneOf(column: SQLiteColumn, values: readonly string[]): SQL {
	return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

export const user = sqliteTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name"),
		email: text("email").notNull().unique("uq_user_email"),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [check("chk_user_status", isOneOf(table.status, USER_STATUSES))]
);

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		token: text("token").notNull().unique("uq_session_token"),
		expiresAt: timestampMs("expires_at").notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		activeOrganizationId: text("active_organization_id"),
		activeNamespaceId: text("active_namespace_id"),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_session_user_id",
			columns: [table.userId],
			foreignColumns: [user.id],
		}).onDelete("cascade"),
		index("idx_session_active_namespace_id").on(table.activeNamespaceId),
	]
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		accessTokenExpiresAt: timestampMs("access_token_expires_at"),
		refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
		scope: text("scope"),
		idToken: text("id_token"),
		password: text("password"),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_account_user_id",
			columns: [table.userId],
			foreignColumns: [user.id],
		}).onDelete("cascade"),
		uniqueIndex("uqidx_account_user_provider").on(table.userId, table.providerId),
	]
);

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestampMs("expires_at").notNull(),
	createdAt: timestampMs("created_at").notNull().default(NOW_MS),
	updatedAt: updatedAtMs(),
});

export const organization = sqliteTable(
	"organization",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique("uq_organization_slug"),
		logo: text("logo"),
		metadata: text("metadata", { mode: "json" }),
		type: text("type", { enum: ORGANIZATION_TYPES }).notNull(),
		status: text("status", { enum: ORGANIZATION_STATUSES }).notNull().default("active"),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		check("chk_organization_type", isOneOf(table.type, ORGANIZATION_TYPES)),
		check("chk_organization_status", isOneOf(table.status, ORGANIZATION_STATUSES)),
	]
);

export const organizationMember = sqliteTable(
	"organization_member",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		role: text("role", { enum: ORGANIZATION_ROLES }).notNull(),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_org_member_user_id",
			columns: [table.userId],
			foreignColumns: [user.id],
		}),
		foreignKey({
			name: "fk_org_member_org_id",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}),
		uniqueIndex("uqidx_org_member_org_user").on(table.organizationId, table.userId),
		index("idx_org_member_user_id").on(table.userId),
		check("chk_org_member_role", isOneOf(table.role, ORGANIZATION_ROLES)),
	]
);

export const organizationInvitation = sqliteTable(
	"organization_invitation",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		inviterId: text("inviter_id").notNull(),
		organizationId: text("organization_id").notNull(),
		role: text("role", { enum: ORGANIZATION_ROLES }).notNull(),
		status: text("status", { enum: ORGANIZATION_INVITATION_STATUSES }).notNull(),
		namespaceId: text("namespace_id"),
		expiresAt: timestampMs("expires_at").notNull(),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_org_invitation_inviter_id",
			columns: [table.inviterId],
			foreignColumns: [user.id],
		}),
		foreignKey({
			name: "fk_org_invitation_organization_id",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}),
		uniqueIndex("uqidx_org_invitation_pending_email_org_namespace")
			.on(table.email, table.organizationId, table.namespaceId)
			.where(sql`${table.status} = 'pending'`),
		check("chk_org_invitation_role", isOneOf(table.role, ORGANIZATION_ROLES)),
		check("chk_org_invitation_status", isOneOf(table.status, ORGANIZATION_INVITATION_STATUSES)),
	]
);

export const namespace = sqliteTable(
	"namespace",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		organizationId: text("organization_id").notNull(),
		status: text("status", { enum: NAMESPACE_STATUSES }).notNull().default("active"),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_namespace_org_id",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}),
		uniqueIndex("uqidx_namespace_org_name").on(table.organizationId, table.name),
		check("chk_namespace_status", isOneOf(table.status, NAMESPACE_STATUSES)),
	]
);

export const namespaceMember = sqliteTable(
	"namespace_member",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		userId: text("user_id").notNull(),
		role: text("role", { enum: NAMESPACE_ROLES }).notNull().default("viewer"),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_namespace_member_namespace_id",
			columns: [table.namespaceId],
			foreignColumns: [namespace.id],
		}),
		foreignKey({
			name: "fk_namespace_member_user_id",
			columns: [table.userId],
			foreignColumns: [user.id],
		}),
		uniqueIndex("uqidx_namespace_member_namespace_user").on(table.namespaceId, table.userId),
		index("idx_namespace_member_user_id").on(table.userId),
		check("chk_namespace_member_role", isOneOf(table.role, NAMESPACE_ROLES)),
	]
);

export const apiKey = sqliteTable(
	"api_key",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		organizationId: text("organization_id").notNull(),
		createdByUserId: text("created_by_user_id").notNull(),
		name: text("name").notNull(),
		keyHash: text("key_hash").notNull().unique("uq_api_key_key_hash"),
		keyPrefix: text("key_prefix").notNull(),
		status: text("status", { enum: API_KEY_STATUSES }).notNull().default("active"),
		expiresAt: timestampMs("expires_at"),
		revokedAt: timestampMs("revoked_at"),
		createdAt: timestampMs("created_at").notNull().default(NOW_MS),
		updatedAt: updatedAtMs(),
	},
	(table) => [
		foreignKey({
			name: "fk_api_key_namespace_id",
			columns: [table.namespaceId],
			foreignColumns: [namespace.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "fk_api_key_organization_id",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "fk_api_key_created_by_user_id",
			columns: [table.createdByUserId],
			foreignColumns: [user.id],
		}),
		uniqueIndex("uqidx_api_key_namespace_created_by_user_name").on(
			table.namespaceId,
			table.createdByUserId,
			table.name
		),
		index("idx_api_key_namespace_name").on(table.namespaceId, table.name),
		check("chk_api_key_status", isOneOf(table.status, API_KEY_STATUSES)),
	]
);
