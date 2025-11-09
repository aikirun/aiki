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

	// Add npm-specific note at the top if not already present
	if (!transformed.includes("npm install")) {
		// Already handled by the replacements above
	}

	return transformed;
}
