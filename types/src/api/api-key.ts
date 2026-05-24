export const API_KEY_STATUSES = ["active", "revoked", "expired"] as const;
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];

export interface ApiKeyInfo {
	id: string;
	name: string;
	keyPrefix: string;
	status: ApiKeyStatus;
	createdAt: number;
	expiresAt: number | null;
}

export interface ApiKeyCreateRequestV1 {
	namespaceId: string;
	name: string;
	expiresAt?: number;
}

export interface ApiKeyCreateResponseV1 {
	key: string;
	info: ApiKeyInfo;
}

export interface ApiKeyListRequestV1 {
	namespaceId: string;
}

export interface ApiKeyListResponseV1 {
	keyInfos: ApiKeyInfo[];
}

export interface ApiKeyRevokeRequestV1 {
	id: string;
	namespaceId: string;
}

export interface ApiKeyApi {
	createV1: (_: ApiKeyCreateRequestV1) => Promise<ApiKeyCreateResponseV1>;
	listV1: (_: ApiKeyListRequestV1) => Promise<ApiKeyListResponseV1>;
	revokeV1: (_: ApiKeyRevokeRequestV1) => Promise<void>;
}
