/**
 * Extracts the `redirect` query param and returns it only when it resolves to a
 * same-origin path, preventing open-redirect phishing.
 */
export function getSafeRedirect(search: string, origin: string = window.location.origin): string | null {
	const redirectParam = new URLSearchParams(search).get("redirect");
	if (!redirectParam?.startsWith("/")) {
		return null;
	}

	try {
		const resolved = new URL(redirectParam, origin);
		if (resolved.origin !== origin) {
			return null;
		}
		return `${resolved.pathname}${resolved.search}${resolved.hash}`;
	} catch {
		return null;
	}
}
