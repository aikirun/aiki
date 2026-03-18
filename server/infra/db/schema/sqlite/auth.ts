/**
 * SQLite schema for Aiki auth (users, orgs, namespaces, API keys)
 * Translated from server/infra/db/schema/pg/auth.ts
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Note: SQLite doesn't have ENUM types. We store as text and validate at application layer.
// Constants like USER_STATUSES, ORGANIZATION_STATUSES, etc. are used for validation.

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name"),
	email: text("email").notNull().unique("uq_user_email"),
	emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
	image: text("image"),
	status: text("status").notNull().default("active"), // user_status enum
	createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const session = sqliteTable("session", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	token: text("token").notNull().unique("uq_session_token"),
	expiresAt: text("expires_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	activeOrganizationId: text("active_organization_id"),
	activeNamespaceId: text("active_namespace_id"),
	createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		accessTokenExpiresAt: text("access_token_expires_at"),
		refreshTokenExpiresAt: text("refresh_token_expires_at"),
		scope: text("scope"),
		idToken: text("id_token"),
		password: text("password"),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [uniqueIndex("uqidx_account_user_provider").on(table.userId, table.providerId)]
);

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: text("expires_at").notNull(),
	createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const organization = sqliteTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique("uq_organization_slug"),
	logo: text("logo"),
	metadata: text("metadata", { mode: "json" }),
	type: text("type").notNull(), // organization_type enum
	status: text("status").notNull().default("active"), // organization_status enum
	createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const organizationMember = sqliteTable(
	"organization_member",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		role: text("role").notNull(), // organization_role enum
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		uniqueIndex("uqidx_org_member_org_user").on(table.organizationId, table.userId),
		index("idx_org_member_user_id").on(table.userId),
	]
);

export const organizationInvitation = sqliteTable(
	"organization_invitation",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		inviterId: text("inviter_id")
			.notNull()
			.references(() => user.id),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		role: text("role").notNull(), // organization_role enum
		status: text("status").notNull(), // organization_invitation_status enum
		namespaceId: text("namespace_id"),
		expiresAt: text("expires_at").notNull(),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		// Partial unique index for pending invitations
		uniqueIndex("uqidx_org_invitation_pending_email_org_namespace")
			.on(table.email, table.organizationId, table.namespaceId)
			.where(sql`${table.status} = 'pending'`),
	]
);

export const namespace = sqliteTable(
	"namespace",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id),
		status: text("status").notNull().default("active"), // namespace_status enum
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [uniqueIndex("uqidx_namespace_org_name").on(table.organizationId, table.name)]
);

export const namespaceMember = sqliteTable(
	"namespace_member",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id")
			.notNull()
			.references(() => namespace.id),
		userId: text("user_id")
			.notNull()
			.references(() => user.id),
		role: text("role").notNull(), // namespace_role enum
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		uniqueIndex("uqidx_namespace_member_namespace_user").on(table.namespaceId, table.userId),
		index("idx_namespace_member_user_id").on(table.userId),
	]
);

export const apiKey = sqliteTable(
	"api_key",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id")
			.notNull()
			.references(() => namespace.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id),
		name: text("name").notNull(),
		keyHash: text("key_hash").notNull().unique("uq_api_key_key_hash"),
		keyPrefix: text("key_prefix").notNull(),
		status: text("status").notNull().default("active"), // api_key_status enum
		expiresAt: text("expires_at"),
		revokedAt: text("revoked_at"),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(table) => [
		uniqueIndex("uqidx_api_key_org_namespace_created_by_user_name").on(
			table.organizationId,
			table.namespaceId,
			table.createdByUserId,
			table.name
		),
		index("idx_api_key_org_namespace_name").on(table.organizationId, table.namespaceId, table.name),
	]
);
