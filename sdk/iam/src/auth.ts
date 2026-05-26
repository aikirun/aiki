import type { Database } from "@aikirun/types/infra/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/postgres-js";

import type { PgClient } from "./infra/db/pg/provider";
import * as pgIamSchema from "./infra/db/pg/schema/iam";
import { extractDbClient } from "./infra/db/repo";

const pgBetterAuthSchema = {
	user: pgIamSchema.user,
	session: pgIamSchema.session,
	account: pgIamSchema.account,
	verification: pgIamSchema.verification,
	organization: pgIamSchema.organization,
	organization_member: pgIamSchema.organizationMember,
	organization_invitation: pgIamSchema.organizationInvitation,
	namespace: pgIamSchema.namespace,
	namespace_member: pgIamSchema.namespaceMember,
};

// Inferred from PG's betterAuthSchema — enforces that all providers
// export a schema object with the same keys.
// The values are `unknown` because PG uses pgTable objects and SQLite
// uses sqliteTable objects — different types, same key structure.
type BetterAuthSchema = Record<keyof typeof pgBetterAuthSchema, unknown>;

function createDrizzleAdapter(db: Database) {
	switch (db.provider) {
		case "pg": {
			const schema: BetterAuthSchema = pgBetterAuthSchema;
			const client = extractDbClient(db) as PgClient;
			const handle = drizzle(client, { schema });
			return drizzleAdapter(handle, { provider: db.provider, schema });
		}
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
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

export function createAuthService(params: AuthServiceParams) {
	return betterAuth({
		database: createDrizzleAdapter(params.db),
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

export type AuthService = ReturnType<typeof createAuthService>;
