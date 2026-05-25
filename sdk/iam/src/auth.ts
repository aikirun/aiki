import { type PgDatabaseConn, pgBetterAuthSchema } from "@aikirun/server/internal/db-pg";
import { extractDatabaseConn } from "@aikirun/server/internal/repo";
import type { Database } from "@aikirun/types/infra/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

export interface AuthOptions {
	db: Database;
	baseURL: string;
	secret: string;
	trustedOrigins: string[];
}

function createDrizzleAdapter(db: Database) {
	switch (db.provider) {
		case "pg":
			return drizzleAdapter(extractDatabaseConn(db) as PgDatabaseConn, {
				provider: db.provider,
				schema: pgBetterAuthSchema,
			});
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		default:
			return db.provider satisfies never;
	}
}

export function createAuthService(options: AuthOptions) {
	return betterAuth({
		database: createDrizzleAdapter(options.db),
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
