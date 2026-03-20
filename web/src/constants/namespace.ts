export function getNamespaceDotColor(name: string): string {
	const lower = name.toLowerCase();
	if (lower.includes("prod")) return "#34D399";
	if (lower.includes("stag")) return "#FBBF24";
	return "#A78BFA";
}
