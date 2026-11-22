import { describe, expect, test } from "vitest";

import { createIamHarness } from "./testing/harness";
import { seedSignedInUser } from "./testing/seed/user";

const withHarness = createIamHarness();

describe("organization dashboard handler", () => {
	test("refuses a user who signed out", () =>
		withHarness(async (deps) => {
			const user = await seedSignedInUser(deps);
			await user.callAuth("/sign-out", {});
			expect(await user.readAuth("/get-session")).toEqual({ status: 200, body: null });

			const response = await user.callDashboard("/namespace/listV1", undefined);

			expect(response).toEqual({ status: 401, error: "Not authenticated" });
		}));

	test("refuses a user with no active organization", () =>
		withHarness(async (deps) => {
			const user = await seedSignedInUser(deps);
			expect(await user.readAuth("/get-session")).toEqual({
				status: 200,
				body: expect.objectContaining({ session: expect.objectContaining({ activeOrganizationId: null }) }),
			});

			const response = await user.callDashboard("/namespace/listV1", undefined);

			expect(response).toEqual({ status: 401, error: "No active organization selected" });
		}));
});
