import type { NamespaceRole } from "./namespace";

export interface NamespaceApi {
	createV1: (_: NamespaceCreateRequestV1) => Promise<NamespaceCreateResponseV1>;
	listV1: () => Promise<NamespaceListResponseV1>;
	deleteV1: (_: NamespaceDeleteRequestV1) => Promise<void>;
	listForUserV1: (_: NamespaceListForUserRequestV1) => Promise<NamespaceListForUserResponseV1>;
	setMembershipV1: (_: NamespaceSetMembershipRequestV1) => Promise<void>;
	removeMembershipV1: (_: NamespaceRemoveMembershipRequestV1) => Promise<void>;
	listMembersV1: (_: NamespaceListMembersRequestV1) => Promise<NamespaceListMembersResponseV1>;
}

export interface NamespaceInfo {
	id: string;
	name: string;
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

export interface NamespaceListForUserRequestV1 {
	userId: string;
}

export interface NamespaceListForUserResponseV1 {
	namespaces: NamespaceInfo[];
}

export interface NamespaceMemberInput {
	userId: string;
	role: NamespaceRole;
}

export interface NamespaceSetMembershipRequestV1 {
	id: string;
	members: NamespaceMemberInput[];
}

export interface NamespaceRemoveMembershipRequestV1 {
	id: string;
	userId: string;
}

export interface NamespaceMemberInfo {
	userId: string;
	name?: string;
	email: string;
	role: NamespaceRole;
}

export interface NamespaceListMembersRequestV1 {
	id: string;
}

export interface NamespaceListMembersResponseV1 {
	members: NamespaceMemberInfo[];
}
