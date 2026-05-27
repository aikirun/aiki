import type { Capabilities } from "@aikirun/server/capabilities";
import { createContext, type ReactNode, useContext } from "react";

const CapabilitiesContext = createContext<Capabilities | null>(null);

interface CapabilitiesProviderProps {
	value: Capabilities;
	children: ReactNode;
}

export function CapabilitiesProvider({ value, children }: CapabilitiesProviderProps) {
	return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): Capabilities {
	const value = useContext(CapabilitiesContext);
	if (!value) {
		throw new Error("useCapabilities must be called within a CapabilitiesProvider");
	}
	return value;
}
