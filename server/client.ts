import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "./router.ts";

export function apiClient(params: { baseUrl: string }): TRPCClient<AppRouter> {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${params.baseUrl}/api`,
			}),
		],
	});
}

export type ApiClient = ReturnType<typeof apiClient>;
