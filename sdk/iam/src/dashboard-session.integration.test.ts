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

			await expect(user.dashboard.namespace.listV1()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
				status: 401,
				message: "Not authenticated",
			});
		}));

	test("refuses a user with no active organization", () =>
		withHarness(async (deps) => {
			const user = await seedSignedInUser(deps);
			expect(await user.readAuth("/get-session")).toEqual({
				status: 200,
				body: expect.objectContaining({ session: expect.objectContaining({ activeOrganizationId: null }) }),
			});

			await expect(user.dashboard.namespace.listV1()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
				status: 401,
				message: "No active organization selected",
			});
		}));
});
