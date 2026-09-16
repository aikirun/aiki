import { namespaceAuthedImplementer } from "./implementer";

export function createIdentityRouter() {
	const os = namespaceAuthedImplementer.identity;

	return os.router({
		getV1: os.getV1.handler(async ({ context }) => ({
			organizationId: context.organizationId,
			namespaceId: context.namespaceId,
		})),
	});
}
