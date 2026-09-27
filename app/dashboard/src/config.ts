export const AIKI_SERVER_URL =
	import.meta.env.VITE_AIKI_SERVER_URL || (import.meta.env.DEV ? "http://localhost:9850" : window.location.origin);
