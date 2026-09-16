export interface IdentityApi {
	getV1: (_: IdentityGetRequestV1) => Promise<IdentityGetResponseV1>;
}

export type IdentityGetRequestV1 = Record<never, never>;

export interface IdentityGetResponseV1 {
	organizationId: string;
	namespaceId: string;
}
