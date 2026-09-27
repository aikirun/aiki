// `with { type: "file" }` imports resolve to a path string; bun embeds the file
// into the executable when compiling with `bun build --compile`.
declare module "*.data" {
	const filePath: string;
	export default filePath;
}
