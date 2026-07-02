/// <reference types="vite/client" />

// biome-ignore lint/correctness/noUnusedVariables: Only needed for typing VITE_AIKI_SERVER_URL
interface ImportMetaEnv {
	readonly VITE_AIKI_SERVER_URL?: string;
}
