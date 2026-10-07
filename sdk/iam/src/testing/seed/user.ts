import type { ApiAuthorization } from "@aikirun/types/iam";
import { ulid } from "ulidx";

import type { IamHarnessDeps } from "../harness";

export type SeedUserDeps = IamHarnessDeps;

/** A user's browser: it keeps the session cookie and sends it with every request. */
export interface SignedInUser {
	userId: string;
	email: string;
	callAuth(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> | null }>;
	/** Reads an auth route. The body is the parsed JSON, or the text when the response is not JSON. */
	readAuth(path: string): Promise<{ status: number; body: unknown }>;
	callDashboard(path: string, input: unknown): Promise<{ status: number; output?: unknown; error?: string }>;
	authorizeApiRequest(): Promise<ApiAuthorization>;
}

/** A new user with a session of their own, signed up the way the dashboard signs one up. */
export async function seedSignedInUser(deps: SeedUserDeps): Promise<SignedInUser> {
	const { baseURL, dashboardOrigin, dashboardIam, authorizeApiRequest } = deps;
	const email = `${ulid().toLowerCase()}@example.com`;
	const cookies = new Map<string, string>();

	const headers = () => {
		const requestHeaders = new Headers({ "content-type": "application/json", origin: dashboardOrigin });
		if (cookies.size > 0) {
			requestHeaders.set("cookie", Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; "));
		}
		return requestHeaders;
	};
	const send = async (handler: (request: Request) => Promise<Response>, request: Request) => {
		const response = await handler(request);
		for (const setCookie of response.headers.getSetCookie()) {
			const [nameAndValue = ""] = setCookie.split(";");
			const separatorIndex = nameAndValue.indexOf("=");
			cookies.set(nameAndValue.slice(0, separatorIndex), nameAndValue.slice(separatorIndex + 1));
		}
		return { status: response.status, text: await response.text() };
	};
	const post = (handler: (request: Request) => Promise<Response>, path: string, body: unknown) =>
		send(handler, new Request(`${baseURL}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) }));

	const callAuth = async (path: string, body: unknown) => {
		const { status, text } = await post(dashboardIam.authenticator, `/auth${path}`, body);
		return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
	};
	const signedUp = await callAuth("/sign-up/email", { name: "Test User", email, password: "correct-horse-battery" });

	return {
		userId: (signedUp.body?.user as { id: string }).id,
		email,
		callAuth,
		async readAuth(path) {
			const request = new Request(`${baseURL}/auth${path}`, { headers: headers() });
			const { status, text } = await send(dashboardIam.authenticator, request);
			const isJson = text.startsWith("{") || text.startsWith("[") || text === "null";
			return { status, body: isJson ? (JSON.parse(text) as unknown) : text };
		},
		async callDashboard(path, input) {
			const { status, text } = await post(dashboardIam.organization, `/dashboard${path}`, { json: input });
			if (status === 200) {
				return { status, output: (JSON.parse(text) as { json?: unknown }).json };
			}
			// A refusal from a route is JSON with a message; one from before the routes is plain text.
			const error = text.startsWith("{") ? (JSON.parse(text) as { json: { message: string } }).json.message : text;
			return { status, error };
		},
		async authorizeApiRequest() {
			return authorizeApiRequest(new Request(`${baseURL}/api/workflowRun/listV1`, { headers: headers() }));
		},
	};
}
