export interface NamespaceInfo {
	id: string;
	name: string;
	organizationId: string;
	createdAt: number;
}

export interface NamespaceCreateRequestV1 {
	name: string;
}

export interface NamespaceCreateResponseV1 {
	namespace: NamespaceInfo;
}

export interface NamespaceApi {
	createV1: (_: NamespaceCreateRequestV1) => Promise<NamespaceCreateResponseV1>;
}
