import { namespaceContract } from "./procedure/namespace";

export const organizationAuthedContract = {
	namespace: namespaceContract,
};

export type OrganizationAuthedContract = typeof organizationAuthedContract;
