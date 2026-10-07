import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization } from "better-auth/plugins";

import type { PgClient } from "./infra/db/pg/provider";
import { createRepos } from "./infra/db/repo";
import type { SqliteClient } from "./infra/db/sqlite/provider";

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
		case "sqlite": {
			const schema = await import("./infra/db/sqlite/schema");
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
			const client = db[INTERNAL].client as SqliteClient;
			const { drizzle } = await import("drizzle-orm/libsql");
			const handle = drizzle(client, { schema: betterAuthSchema });
			return drizzleAdapter(handle, { provider: db.provider, schema: betterAuthSchema });
		}
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
			const client = db[INTERNAL].client as PgClient;
			const { drizzle } = await import("drizzle-orm/postgres-js");
			const handle = drizzle(client, { schema: betterAuthSchema });
			return drizzleAdapter(handle, { provider: db.provider, schema: betterAuthSchema });
		}
		// case "mysql":
		// 	throw new Error("MySQL support not yet implemented");
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

interface OrganizationWithInvitations {
	id: string;
	invitations: unknown[];
}

function isOrganizationWithInvitations(value: unknown): value is OrganizationWithInvitations {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"invitations" in value &&
		Array.isArray(value.invitations)
	);
}

export async function createAuthService(params: AuthServiceParams) {
	const repos = await createRepos(params.db);

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

		// A signed-in user accepts an invitation with its id, and Aiki cannot ask anyone to prove an
		// address is theirs. An organization's invitations are therefore readable only by the roles
		// that can send one. This route hands them to any member, and the dashboard does not use it.
		disabledPaths: ["/organization/list-invitations"],

		hooks: {
			after: createAuthMiddleware(async (context) => {
				if (context.path !== "/organization/get-full-organization") {
					return;
				}

				const organization = context.context.returned;
				if (!isOrganizationWithInvitations(organization)) {
					return;
				}

				const session = await getSessionFromCtx(context);
				const organizationRole = session
					? await repos.organization.getMemberRole(organization.id, session.user.id)
					: null;
				if (organizationRole === "owner" || organizationRole === "admin") {
					return;
				}

				return context.json({ ...organization, invitations: [] });
			}),
		},

		plugins: [
			organization({
				// Aiki sends no email, so no address is ever verified. Requiring it would refuse every invitation.
				requireEmailVerificationOnInvitation: false,
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
