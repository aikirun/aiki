import { apiKeyContract } from "./procedure/api-key";
import { namespaceContract } from "./procedure/namespace";

export const organizationAuthedContract = {
	apiKey: apiKeyContract,
	namespace: namespaceContract,
};

export type OrganizationAuthedContract = typeof organizationAuthedContract;
