import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import type { DatabaseProvider } from "server/config/schema";
import type { BetterAuthSchema } from "server/infra/db/types";

export interface AuthOptions {
	conn: Parameters<typeof drizzleAdapter>[0];
	provider: DatabaseProvider;
	betterAuthSchema: BetterAuthSchema;
	baseURL: string;
	secret: string;
	corsOrigins: string[];
}

export function createAuthService(options: AuthOptions) {
	return betterAuth({
		database: drizzleAdapter(options.conn, { provider: options.provider, schema: options.betterAuthSchema }),
		baseURL: options.baseURL,
		basePath: "/auth",
		secret: options.secret,
		trustedOrigins: options.corsOrigins,
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
