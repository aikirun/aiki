import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseProvider } from "@aikirun/types/infra/db";

const require = createRequire(import.meta.url);

export function resolveServerMigrationsDir(provider: DatabaseProvider): string {
	const serverRoot = resolveServerRoot();
	return path.join(serverRoot, "dist", "infra", "db", provider, "migration");
}

export function resolveServerRoot(): string {
	try {
		const serverPackageJsonPath = require.resolve("@aikirun/server/package.json");
		return path.dirname(serverPackageJsonPath);
	} catch {
		throw new Error("@aikirun/server is not installed. Install it as a dependency of your project.");
	}
}
