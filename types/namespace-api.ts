import type { NamespaceRole } from "./namespace";

export interface NamespaceApi {
	createV1: (_: NamespaceCreateRequestV1) => Promise<NamespaceCreateResponseV1>;
	listV1: () => Promise<NamespaceListResponseV1>;
	deleteV1: (_: NamespaceDeleteRequestV1) => Promise<void>;
}

export interface NamespaceInfo {
	id: string;
	name: string;
	organizationId: string;
	createdAt: number;
	role: NamespaceRole;
}

export interface NamespaceCreateRequestV1 {
	name: string;
}

export interface NamespaceCreateResponseV1 {
	namespace: NamespaceInfo;
}

export interface NamespaceListResponseV1 {
	namespaces: NamespaceInfo[];
}

export interface NamespaceDeleteRequestV1 {
	id: string;
}
