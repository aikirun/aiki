import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import type { DatabaseConn } from "../infra/db";
import * as schema from "../infra/db/schema/pg";

const schemaForBetterAuth = {
	user: schema.user,
	session: schema.session,
	account: schema.account,
	verification: schema.verification,
	organization: schema.organization,
	organization_member: schema.organizationMember,
	organization_invitation: schema.organizationInvitation,
	namespace: schema.namespace,
	namespace_member: schema.namespaceMember,
};

export interface AuthOptions {
	db: DatabaseConn;
	baseURL: string;
	secret: string;
	corsOrigins: string[];
}

export function createAuthService(options: AuthOptions) {
	return betterAuth({
		database: drizzleAdapter(options.db, { provider: "pg", schema: schemaForBetterAuth }),
		baseURL: options.baseURL,
		basePath: "/auth",
		secret: options.secret,
		trustedOrigins: options.corsOrigins,

		emailAndPassword: {
			enabled: true,
		},

		plugins: [
			organization({
				teams: {
					enabled: true,
					defaultTeam: {
						enabled: false,
					},
				},
				schema: {
					organization: {
						additionalFields: {
							type: {
								type: "string",
								required: true,
								input: true,
							},
						},
					},
					session: {
						fields: {
							activeTeamId: "activeNamespaceId",
						},
					},
					member: {
						modelName: "organization_member",
					},
					invitation: {
						modelName: "organization_invitation",
						fields: {
							teamId: "namespaceId",
						},
					},
					team: {
						modelName: "namespace",
					},
					teamMember: {
						modelName: "namespace_member",
						fields: {
							teamId: "namespaceId",
						},
					},
				},
			}),
		],
	});
}

export type AuthService = ReturnType<typeof createAuthService>;
