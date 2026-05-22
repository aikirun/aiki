import type { betterAuthSchema } from "../pg/schema/better-auth";

// Inferred from PG's betterAuthSchema — enforces that all providers
// export a schema object with the same keys.
// The values are `unknown` because PG uses pgTable objects and SQLite
// uses sqliteTable objects — different types, same key structure.
export type BetterAuthSchema = Record<keyof typeof betterAuthSchema, unknown>;
