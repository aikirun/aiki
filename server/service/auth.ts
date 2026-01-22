import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import type { DatabaseConn } from "../infra/db";
import * as schema from "../infra/db/schema/pg";

export interface AuthOptions {
	db: DatabaseConn;
	baseURL: string;
	secret: string;
	corsOrigins: string[];
}

export function createAuthService(options: AuthOptions) {
	return betterAuth({
		database: drizzleAdapter(options.db, { provider: "pg", schema }),
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
