import { namespaceAuthedProcedureImplementer } from "./implementer";

export function createIdentityRouter() {
	const os = namespaceAuthedProcedureImplementer.identity;

	return os.router({
		getV1: os.getV1.handler(async ({ context }) => ({
			organizationId: context.organizationId,
			namespaceId: context.namespaceId,
		})),
	});
}
