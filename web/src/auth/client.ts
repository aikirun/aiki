import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const AIKI_SERVER_URL = import.meta.env.VITE_AIKI_SERVER_URL || "http://localhost:9850";

export const authClient = createAuthClient({
	baseURL: AIKI_SERVER_URL,
	basePath: "/auth",
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
