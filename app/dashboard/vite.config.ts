import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	resolve: { tsconfigPaths: true },
	server: {
		port: 9851,
	},
});
