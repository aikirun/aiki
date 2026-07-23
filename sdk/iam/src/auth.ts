import type { Database } from "@aikirun/types/infra/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

import type { PgClient } from "./infra/db/pg/provider";
import { extractDbClient } from "./infra/db/repo";

type BetterAuthSchema = Record<
	| "user"
	| "session"
	| "account"
	| "verification"
	| "organization"
	| "organization_member"
	| "organization_invitation"
	| "namespace"
	| "namespace_member",
	unknown
>;

async function createDrizzleAdapter(db: Database) {
	switch (db.provider) {
		case "pg": {
			const schema = await import("./infra/db/pg/schema");
			const betterAuthSchema = {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification,
				organization: schema.organization,
				organization_member: schema.organizationMember,
				organization_invitation: schema.organizationInvitation,
				namespace: schema.namespace,
				namespace_member: schema.namespaceMember,
			} satisfies BetterAuthSchema;
			const client = extractDbClient(db) as PgClient;
			const { drizzle } = await import("drizzle-orm/postgres-js");
			const handle = drizzle(client, { schema: betterAuthSchema });
			return drizzleAdapter(handle, { provider: db.provider, schema: betterAuthSchema });
		}
		// case "mysql":
		// 	throw new Error("MySQL support not yet implemented");
		// case "sqlite":
		// 	throw new Error("SQLite support not yet implemented");
		default:
			return db.provider satisfies never;
	}
}

export interface AuthServiceParams {
	db: Database;
	baseURL: string;
	secret: string;
	trustedOrigins: string[];
}

export async function createAuthService(params: AuthServiceParams) {
	return betterAuth({
		database: await createDrizzleAdapter(params.db),
		baseURL: params.baseURL,
		basePath: "/auth",
		secret: params.secret,
		trustedOrigins: params.trustedOrigins,
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

export type AuthService = Awaited<ReturnType<typeof createAuthService>>;
