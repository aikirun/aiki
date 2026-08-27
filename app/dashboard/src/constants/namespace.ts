export function getNamespaceDotColor(name: string): string {
	const lower = name.toLowerCase();
	if (lower.includes("prod")) return "var(--accent-green)";
	if (lower.includes("stag")) return "var(--accent-amber)";
	return "var(--accent-purple)";
}
