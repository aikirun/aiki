import { ulid } from "ulidx";
import { describe, expect, test } from "vitest";

import { createIamHarness } from "../testing/harness";
import { seedRemovedNamespace } from "../testing/seed/organization";
import type { SignedInUser } from "../testing/seed/user";

const withHarness = createIamHarness();

describe("a removed namespace", () => {
	const callByRoute = {
		createV1: (owner: SignedInUser, namespaceId: string) =>
			owner.dashboard.apiKey.createV1({ namespaceId, name: "deploy" }),
		listV1: (owner: SignedInUser, namespaceId: string) => owner.dashboard.apiKey.listV1({ namespaceId }),
		revokeV1: (owner: SignedInUser, namespaceId: string) =>
			owner.dashboard.apiKey.revokeV1({ id: ulid(), namespaceId }),
	};

	for (const [route, callRoute] of Object.entries(callByRoute)) {
		test(`is not found by ${route}`, () =>
			withHarness(async (deps) => {
				const { owner, removedNamespaceId } = await seedRemovedNamespace(deps);

				await expect(callRoute(owner, removedNamespaceId)).rejects.toMatchObject({
					code: "NOT_FOUND",
					status: 404,
					message: "Namespace not found",
				});
			}));
	}
});
