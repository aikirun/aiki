import { ulid } from "ulidx";
import { describe, expect, test } from "vitest";

import { createIamHarness } from "../testing/harness";
import { seedRemovedNamespace } from "../testing/seed/organization";
import type { SignedInUser } from "../testing/seed/user";

const withHarness = createIamHarness();

describe("a removed namespace", () => {
	const callByRoute = {
		createV1: (owner: SignedInUser, namespaceId: string) =>
			owner.callDashboard("/apiKey/createV1", { namespaceId, name: "deploy" }),
		listV1: (owner: SignedInUser, namespaceId: string) => owner.callDashboard("/apiKey/listV1", { namespaceId }),
		revokeV1: (owner: SignedInUser, namespaceId: string) =>
			owner.callDashboard("/apiKey/revokeV1", { id: ulid(), namespaceId }),
	};

	for (const [route, callRoute] of Object.entries(callByRoute)) {
		test(`is not found by ${route}`, () =>
			withHarness(async (deps) => {
				const { owner, removedNamespaceId } = await seedRemovedNamespace(deps);

				const response = await callRoute(owner, removedNamespaceId);

				expect(response).toEqual({ status: 404, error: "Namespace not found" });
			}));
	}
});
