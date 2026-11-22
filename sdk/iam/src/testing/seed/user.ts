import type { ApiAuthorization } from "@aikirun/types/iam";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { ulid } from "ulidx";

import type { OrganizationAuthedContract } from "../../contract/organization-authed";
import type { IamHarnessDeps } from "../harness";

export type SeedUserDeps = IamHarnessDeps;

/** A user's browser: it keeps the session cookie and sends it with every request. */
export interface SignedInUser {
	userId: string;
	email: string;
	callAuth(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> | null }>;
	/** Reads an auth route. The body is the parsed JSON, or the text when the response is not JSON. */
	readAuth(path: string): Promise<{ status: number; body: unknown }>;
	/** Calls the dashboard procedures with this user's session, through the oRPC client the dashboard uses. */
	dashboard: ContractRouterClient<OrganizationAuthedContract>;
	authorizeApiRequest(): Promise<ApiAuthorization>;
}

/** A new user with a session of their own, signed up the way the dashboard signs one up. */
export async function seedSignedInUser(deps: SeedUserDeps): Promise<SignedInUser> {
	const { baseURL, dashboardOrigin, dashboardIam, authorizeApiRequest } = deps;
	const email = `${ulid().toLowerCase()}@example.com`;
	const cookies = new Map<string, string>();

	const cookieHeader = () =>
		cookies.size > 0 ? Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ") : undefined;
	const headers = () => {
		const requestHeaders = new Headers({ "content-type": "application/json", origin: dashboardOrigin });
		const cookie = cookieHeader();
		if (cookie) {
			requestHeaders.set("cookie", cookie);
		}
		return requestHeaders;
	};
	const keepCookies = (response: Response) => {
		for (const setCookie of response.headers.getSetCookie()) {
			const [nameAndValue = ""] = setCookie.split(";");
			const separatorIndex = nameAndValue.indexOf("=");
			cookies.set(nameAndValue.slice(0, separatorIndex), nameAndValue.slice(separatorIndex + 1));
		}
	};
	const send = async (handler: (request: Request) => Promise<Response>, request: Request) => {
		const response = await handler(request);
		keepCookies(response);
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
		dashboard: createORPCClient<ContractRouterClient<OrganizationAuthedContract>>(
			new RPCLink({
				url: `${baseURL}/dashboard`,
				headers: () => ({ origin: dashboardOrigin, cookie: cookieHeader() }),
				fetch: async (request) => {
					const response = await dashboardIam.organization(request);
					keepCookies(response);
					return response;
				},
			})
		),
		async authorizeApiRequest() {
			return authorizeApiRequest(new Request(`${baseURL}/api/workflowRun/listV1`, { headers: headers() }));
		},
	};
}
