import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import type { DatabaseProvider } from "../config";
import type { BetterAuthSchema } from "../infra/db/types/better-auth";

export interface AuthOptions {
	dbConn: Parameters<typeof drizzleAdapter>[0];
	dbProvider: DatabaseProvider;
	betterAuthSchema: BetterAuthSchema;
	baseURL: string;
	secret: string;
	trustedOrigins: string[];
}

export function createAuthService(options: AuthOptions) {
	return betterAuth({
		database: drizzleAdapter(options.dbConn, { provider: options.dbProvider, schema: options.betterAuthSchema }),
		baseURL: options.baseURL,
		basePath: "/auth",
		secret: options.secret,
		trustedOrigins: options.trustedOrigins,
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
			},
		},

		emailAndPassword: {
			enabled: true,
		},

		plugins: [
			organization({
				organizationHooks: {
					beforeDeleteTeam: async () => {
						throw new Error("Namespaces cannot be hard-deleted");
					},
				},
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
