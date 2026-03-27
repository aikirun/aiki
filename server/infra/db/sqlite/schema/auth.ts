import { API_KEY_STATUSES } from "@aikirun/types/api-key-api";
import { sql } from "drizzle-orm";
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { SQLITE_CURRENT_TIMESTAMP_MS, sqliteJson, sqliteTimestampMs } from "./timestamp";
import { NAMESPACE_ROLES, NAMESPACE_STATUSES } from "../../constants/namespace";
import {
	ORGANIZATION_INVITATION_STATUSES,
	ORGANIZATION_ROLES,
	ORGANIZATION_STATUSES,
	ORGANIZATION_TYPES,
} from "../../constants/organization";
import { USER_STATUSES } from "../../constants/user";

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name"),
	email: text("email").notNull().unique("uq_user_email"),
	emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
	image: text("image"),
	status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
	createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
	updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		token: text("token").notNull().unique("uq_session_token"),
		expiresAt: sqliteTimestampMs("expires_at").notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		activeOrganizationId: text("active_organization_id"),
		activeNamespaceId: text("active_namespace_id"),
		createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
		updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
	},
	(table) => [
		foreignKey({
			name: "fk_session_user_id",
			columns: [table.userId],
			foreignColumns: [user.id],
		}).onDelete("cascade"),
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
		accessTokenExpiresAt: sqliteTimestampMs("access_token_expires_at"),
		refreshTokenExpiresAt: sqliteTimestampMs("refresh_token_expires_at"),
		scope: text("scope"),
		idToken: text("id_token"),
		password: text("password"),
		createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
		updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
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
	expiresAt: sqliteTimestampMs("expires_at").notNull(),
	createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
	updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
});

export const organization = sqliteTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique("uq_organization_slug"),
	logo: text("logo"),
	metadata: sqliteJson("metadata"),
	type: text("type", { enum: ORGANIZATION_TYPES }).notNull(),
	status: text("status", { enum: ORGANIZATION_STATUSES }).notNull().default("active"),
	createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
	updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
});

export const organizationMember = sqliteTable(
	"organization_member",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		role: text("role", { enum: ORGANIZATION_ROLES }).notNull(),
		createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
		updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
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
		expiresAt: sqliteTimestampMs("expires_at").notNull(),
		createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
		updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
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
	]
);

export const namespace = sqliteTable(
	"namespace",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		organizationId: text("organization_id").notNull(),
		status: text("status", { enum: NAMESPACE_STATUSES }).notNull().default("active"),
		createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
		updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
	},
	(table) => [
		foreignKey({
			name: "fk_namespace_org_id",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}),
		uniqueIndex("uqidx_namespace_org_name").on(table.organizationId, table.name),
	]
);

export const namespaceMember = sqliteTable(
	"namespace_member",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		userId: text("user_id").notNull(),
		role: text("role", { enum: NAMESPACE_ROLES }).notNull(),
		createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
		updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
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
		expiresAt: sqliteTimestampMs("expires_at"),
		revokedAt: sqliteTimestampMs("revoked_at"),
		createdAt: sqliteTimestampMs("created_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
		updatedAt: sqliteTimestampMs("updated_at").notNull().default(SQLITE_CURRENT_TIMESTAMP_MS),
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
		uniqueIndex("uqidx_api_key_org_namespace_created_by_user_name").on(
			table.organizationId,
			table.namespaceId,
			table.createdByUserId,
			table.name
		),
		index("idx_api_key_org_namespace_name").on(table.organizationId, table.namespaceId, table.name),
	]
);
