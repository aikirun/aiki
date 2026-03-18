import { useCallback, useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "aiki-theme";

function getSnapshot(): Theme {
	return (document.documentElement.dataset.theme as Theme) || "dark";
}

function getServerSnapshot(): Theme {
	return "dark";
}

function subscribe(callback: () => void): () => void {
	const observer = new MutationObserver(callback);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
}

// Initialize on module load — apply before first React render to avoid flash
const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
if (stored === "light") {
	document.documentElement.dataset.theme = "light";
}

export function useTheme() {
	const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

	const setTheme = useCallback((next: Theme) => {
		document.documentElement.dataset.theme = next;
		localStorage.setItem(STORAGE_KEY, next);
	}, []);

	const toggleTheme = useCallback(() => {
		const next = getSnapshot() === "dark" ? "light" : "dark";
		setTheme(next);
	}, [setTheme]);

	return { theme, setTheme, toggleTheme } as const;
}
