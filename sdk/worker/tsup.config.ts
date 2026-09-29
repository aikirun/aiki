import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
	removeNodeProtocol: false,
	noExternal: ["@aikirun/lib", "@aikirun/http"],
});
