/**
 * Transform README for npm distribution
 * Converts JSR/Deno-specific instructions to npm-specific ones
 */
export function transformReadmeForNpm(readme: string, packageName: string): string {
	let transformed = readme;

	// Replace deno add instruction with npm install
	transformed = transformed.replace(
		/```bash\s*deno add jsr:@aikirun\/\w+\s*```/g,
		`\`\`\`bash\nnpm install ${packageName}\n\`\`\``,
	);

	// Replace destructured imports
	transformed = transformed.replace(
		/import\s+{\s*([^}]+)\s*}\s+from\s+"jsr:@aikirun\/([^"]+)"/g,
		'import { $1 } from "@aikirun/$2"',
	);

	// Replace inline imports (default imports)
	transformed = transformed.replace(
		/import\s+(\w+)\s+from\s+"jsr:@aikirun\/([^"]+)"/g,
		'import $1 from "@aikirun/$2"',
	);

	// Replace type imports (destructured)
	transformed = transformed.replace(
		/import\s+type\s+{\s*([^}]+)\s*}\s+from\s+"jsr:@aikirun\/([^"]+)"/g,
		'import type { $1 } from "@aikirun/$2"',
	);

	// Replace type imports (inline)
	transformed = transformed.replace(
		/import\s+type\s+(\w+)\s+from\s+"jsr:@aikirun\/([^"]+)"/g,
		'import type $1 from "@aikirun/$2"',
	);

	// Replace JSR package links with npm links in documentation
	// Matches: [@aikirun/package-name](https://jsr.io/@aikirun/package-name)
	// Replaces with: [@aikirun/package-name](https://www.npmjs.com/package/@aikirun/package-name)
	transformed = transformed.replace(
		/\[@aikirun\/([^\]]+)\]\(https:\/\/jsr\.io\/@aikirun\/\1\)/g,
		(_match, packageName) => `[@aikirun/${packageName}](https://www.npmjs.com/package/@aikirun/${packageName})`,
	);

	return transformed;
}
