import { useCallback, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "aiki-theme";

const prefersLight = window.matchMedia("(prefers-color-scheme: light)");

function readStoredPreference(): ThemePreference {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === "light" || stored === "dark") {
		return stored;
	}
	return "system";
}

let preference = readStoredPreference();

function resolveTheme(): ResolvedTheme {
	if (preference === "system") {
		return prefersLight.matches ? "light" : "dark";
	}
	return preference;
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	return () => {
		listeners.delete(callback);
	};
}

function applyAndNotify(): void {
	document.documentElement.dataset.theme = resolveTheme();
	for (const listener of listeners) {
		listener();
	}
}

prefersLight.addEventListener("change", () => {
	if (preference === "system") {
		applyAndNotify();
	}
});

export function useTheme() {
	const themePreference = useSyncExternalStore(subscribe, () => preference);
	const resolvedTheme = useSyncExternalStore(subscribe, resolveTheme);

	const setPreference = useCallback((next: ThemePreference) => {
		preference = next;
		if (next === "system") {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, next);
		}
		applyAndNotify();
	}, []);

	return { preference: themePreference, resolvedTheme, setPreference } as const;
}
