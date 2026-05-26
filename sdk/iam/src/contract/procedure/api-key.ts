import { oc } from "@orpc/contract";
import { type } from "arktype";

import { apiKeyInfoSchema } from "../schema/api-key";

const createV1 = oc
	.input(type({ namespaceId: "string > 0", name: "string > 0", "expiresAt?": "number > 0 | undefined" }))
	.output(type({ key: "string > 0", info: apiKeyInfoSchema }));

const listV1 = oc.input(type({ namespaceId: "string > 0" })).output(type({ keyInfos: apiKeyInfoSchema.array() }));

const revokeV1 = oc.input(type({ id: "string > 0", namespaceId: "string > 0" })).output(type("undefined"));

export const apiKeyContract = {
	createV1,
	listV1,
	revokeV1,
};

export type ApiKeyContract = typeof apiKeyContract;
