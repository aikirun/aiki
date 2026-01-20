import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import type { DatabaseConn } from "../infra/db";

export interface AuthOptions {
	db: DatabaseConn;
	baseURL: string;
	secret: string;
}

export function createAuthService(options: AuthOptions) {
	return betterAuth({
		database: drizzleAdapter(options.db, { provider: "pg" }),
		baseURL: options.baseURL,
		secret: options.secret,

		user: {
			fields: {
				emailVerified: "email_verified",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
		},
		session: {
			fields: {
				userId: "user_id",
				expiresAt: "expires_at",
				ipAddress: "ip_address",
				userAgent: "user_agent",
				activeOrganizationId: "active_organization_id",
				activeTeamId: "active_namespace_id",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
		},
		account: {
			fields: {
				userId: "user_id",
				accountId: "account_id",
				providerId: "provider_id",
				accessToken: "access_token",
				refreshToken: "refresh_token",
				accessTokenExpiresAt: "access_token_expires_at",
				refreshTokenExpiresAt: "refresh_token_expires_at",
				idToken: "id_token",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
		},
		verification: {
			fields: {
				expiresAt: "expires_at",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
		},

		plugins: [
			organization({
				schema: {
					organization: {
						fields: {
							createdAt: "created_at",
						},
					},
					member: {
						modelName: "organization_member",
						fields: {
							organizationId: "organization_id",
							userId: "user_id",
							createdAt: "created_at",
						},
					},
					invitation: {
						modelName: "organization_invitation",
						fields: {
							organizationId: "organization_id",
							inviterId: "inviter_id",
							teamId: "namespace_id",
							expiresAt: "expires_at",
							createdAt: "created_at",
						},
					},
					team: {
						modelName: "namespace",
						fields: {
							organizationId: "organization_id",
							createdAt: "created_at",
							updatedAt: "updated_at",
						},
					},
					teamMember: {
						modelName: "namespace_member",
						fields: {
							teamId: "namespace_id",
							userId: "user_id",
							createdAt: "created_at",
						},
					},
				},
			}),
		],
	});
}

export type AuthService = ReturnType<typeof createAuthService>;
