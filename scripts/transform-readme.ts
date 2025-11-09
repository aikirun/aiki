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

	// Replace any remaining jsr: references with npm equivalents
	transformed = transformed.replace(
		/import\s+{\s*([^}]+)\s*}\s+from\s+"jsr:@aikirun\/([^"]+)"/g,
		'import { $1 } from "@aikirun/$2"',
	);

	// Replace JSR package links with npm links in documentation
	// Matches: [@aikirun/package-name](https://jsr.io/@aikirun/package-name)
	// Replaces with: [@aikirun/package-name](https://www.npmjs.com/package/@aikirun/package-name)
	transformed = transformed.replace(
		/\[@aikirun\/([^\]]+)\]\(https:\/\/jsr\.io\/@aikirun\/\1\)/g,
		(match, packageName) => `[@aikirun/${packageName}](https://www.npmjs.com/package/@aikirun/${packageName})`,
	);

	return transformed;
}
