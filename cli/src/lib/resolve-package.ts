import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export const SUPPORTED_PACKAGES = ["server", "iam"] as const;
export type SupportedPackage = (typeof SUPPORTED_PACKAGES)[number];

export function isSupportedPackage(value: string): value is SupportedPackage {
	for (const pkg of SUPPORTED_PACKAGES) {
		if (pkg === value) {
			return true;
		}
	}
	return false;
}

export function resolvePackageRoot(pkg: SupportedPackage): string {
	const moduleId = `@aikirun/${pkg}/package.json`;
	try {
		const packageJsonPath = require.resolve(moduleId);
		return path.dirname(packageJsonPath);
	} catch {
		throw new Error(`@aikirun/${pkg} is not installed. Install it as a dependency of your project.`);
	}
}
