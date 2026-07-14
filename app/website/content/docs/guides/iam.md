---
title: IAM
description: Multi-tenancy, API keys, and dashboard auth — optional and off by default.
---

Aiki's server runs open by default — no credentials, no tenants, nothing to configure. The optional `@aikirun/iam` package adds identity and access management when you need it: organizations and namespaces for multi-tenancy, API keys for machine clients, and sign-in for the dashboard.

## The default: no IAM

`server({ db })` without an `iam` config accepts every request and tags all workflow runs with a built-in sentinel tenant. There are no credentials to manage, and the dashboard shows workflow data without a sign-in flow.

This is the right shape when the server isn't reachable by anyone you don't trust — running inside your app, on a private network, or behind your own gateway.

## When to adopt IAM

- The server is exposed beyond a trusted network and the API needs credentials
- Multiple teams or customers share one deployment and need isolation
- You want dashboard sign-in and per-namespace API keys

## Adopting IAM

### 1. Install the package

```bash
npm install @aikirun/iam
```

### 2. Apply its schema migration

IAM owns its own tables (users, sessions, organizations, namespaces, members, API keys), migrated separately from the server's:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/aiki \
  npx aiki-iam migrate apply
```

Use the same database as the server or a different one — the two schemas have no foreign keys between them.

### 3. Compose it into the server

```typescript
import { iam } from "@aikirun/iam";
import { database, server } from "@aikirun/server";

const db = database({ provider: "pg", url: databaseUrl });

const aikiServer = server({
	db,
	iam: iam({
		db,
		secret: "your-auth-secret",
		baseURL: "http://localhost:9850",
		trustedOrigins: ["http://localhost:9851"],
	}),
});
```

- `secret` signs sessions and credentials — keep it out of source control
- `baseURL` is the public URL the server is reachable at
- `trustedOrigins` lists the browser origins allowed to authenticate (typically where the dashboard is served)

With IAM composed in, sign-in and the dashboard's admin pages activate — organizations, namespaces, members, invitations, and API keys are all managed from the dashboard UI — and the workflow API now requires credentials: an API key from machine clients, or a signed-in dashboard session in the browser.

### 4. Connect clients with an API key

Create an API key from the dashboard (keys are scoped to a namespace), then pass it to the client:

```typescript
const aikiClient = client({
	url: "http://localhost:9850",
	apiKey: "your-api-key",
});
```

### Bundled standalone server

The bundled `app/server` composes IAM for you when `AIKI_SERVER_AUTH_SECRET` and `AIKI_SERVER_BASE_URL` are both set — see the [Installation Guide](/docs/getting-started/installation#environment-variable-reference).

## Runs created before IAM

Workflow runs created while the server ran without IAM are tagged with the sentinel tenant ID `00000000000000000000000000`. After adopting IAM, decide what to do with them: migrate them into a real organization and namespace with a one-time `UPDATE`, or insert an organization row with the sentinel ID to keep them visible as their own tenant.

## Bring your own IAM

`@aikirun/iam` is one implementation of the server's `Iam` interface. If your infrastructure already has an identity system — JWTs from your gateway, an IdP, mTLS — implement the interface directly and skip the package entirely:

```typescript
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";

const aikiServer = server({
	db,
	iam: {
		api: () => async (request) => {
			const claims = await verifyJwt(request);
			return {
				organizationId: claims.orgId as OrganizationId,
				namespaceId: claims.namespaceId as NamespaceId,
			};
		},
	},
});
```

Whatever IDs your authorizer returns are the tenant IDs the server tags workflow runs with — the server never looks them up in any table, so they can come from token claims, an external service, or anywhere else.

## Next Steps

- **[Installation](/docs/getting-started/installation)** - Environment variables for the bundled server
- **[Client](/docs/core-concepts/client)** - Client configuration, including `apiKey`
