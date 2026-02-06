import { API_KEY_STATUSES } from "@aikirun/types/api-key-api";
import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, jsonb, pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { NAMESPACE_ROLES, NAMESPACE_STATUSES } from "../../model/namespace";
import {
	ORGANIZATION_INVITATION_STATUSES,
	ORGANIZATION_ROLES,
	ORGANIZATION_STATUSES,
	ORGANIZATION_TYPES,
} from "../../model/organization";
import { USER_STATUSES } from "../../model/user";
import { timestampMs } from "../../timestamp";

export const userStatusEnum = pgEnum("user_status", USER_STATUSES);

export const organizationStatusEnum = pgEnum("organization_status", ORGANIZATION_STATUSES);
export const organizationTypeEnum = pgEnum("organization_type", ORGANIZATION_TYPES);
export const organizationRoleEnum = pgEnum("organization_role", ORGANIZATION_ROLES);
export const organizationInvitationStatusEnum = pgEnum(
	"organization_invitation_status",
	ORGANIZATION_INVITATION_STATUSES
);

export const namespaceStatusEnum = pgEnum("namespace_status", NAMESPACE_STATUSES);
export const namespaceRoleEnum = pgEnum("namespace_role", NAMESPACE_ROLES);

export const apiKeyStatusEnum = pgEnum("api_key_status", API_KEY_STATUSES);

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name"),
	email: text("email").notNull().unique("uq_user_email"),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	status: userStatusEnum("status").notNull().default("active"),
	createdAt: timestampMs("created_at").notNull().default(sql`now()`),
	updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
});

export const session = pgTable(
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
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
	},
	(table) => [
		foreignKey({
			name: "fk_session_user_id",
			columns: [table.userId],
			foreignColumns: [user.id],
		}).onDelete("cascade"),
	]
);

export const account = pgTable(
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
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestampMs("expires_at").notNull(),
	createdAt: timestampMs("created_at").notNull().default(sql`now()`),
	updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
});

export const organization = pgTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique("uq_organization_slug"),
	logo: text("logo"),
	metadata: jsonb("metadata"),
	type: organizationTypeEnum("type").notNull(),
	status: organizationStatusEnum("status").notNull().default("active"),
	createdAt: timestampMs("created_at").notNull().default(sql`now()`),
	updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
});

export const organizationMember = pgTable(
	"organization_member",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		organizationId: text("organization_id").notNull(),
		role: organizationRoleEnum("role").notNull(),
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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

export const organizationInvitation = pgTable(
	"organization_invitation",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		inviterId: text("inviter_id").notNull(),
		organizationId: text("organization_id").notNull(),
		role: organizationRoleEnum("role").notNull(),
		status: organizationInvitationStatusEnum("status").notNull(),
		namespaceId: text("namespace_id"),
		expiresAt: timestampMs("expires_at").notNull(),
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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

export const namespace = pgTable(
	"namespace",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		organizationId: text("organization_id").notNull(),
		status: namespaceStatusEnum("status").notNull().default("active"),
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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

export const namespaceMember = pgTable(
	"namespace_member",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		userId: text("user_id").notNull(),
		role: namespaceRoleEnum("role").notNull(),
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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

export const apiKey = pgTable(
	"api_key",
	{
		id: text("id").primaryKey(),
		namespaceId: text("namespace_id").notNull(),
		organizationId: text("organization_id").notNull(),
		createdByUserId: text("created_by_user_id").notNull(),
		name: text("name").notNull(),
		keyHash: text("key_hash").notNull().unique("uq_api_key_key_hash"),
		keyPrefix: text("key_prefix").notNull(),
		status: apiKeyStatusEnum("status").notNull().default("active"),
		expiresAt: timestampMs("expires_at"),
		revokedAt: timestampMs("revoked_at"),
		createdAt: timestampMs("created_at").notNull().default(sql`now()`),
		updatedAt: timestampMs("updated_at").notNull().default(sql`now()`),
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
