import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { AIKI_SERVER_URL } from "../config";

export const authClient = createAuthClient({
	baseURL: AIKI_SERVER_URL,
	basePath: "/auth",
	fetchOptions: {
		credentials: "include",
	},
	plugins: [
		organizationClient({
			teams: {
				enabled: true,
			},
			schema: {
				organization: {
					additionalFields: {
						type: {
							type: "string",
							required: true,
						},
					},
				},
			},
		}),
	],
});
