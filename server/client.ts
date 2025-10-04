import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./router.ts";

export function apiClient(params: { baseUrl: string }) {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${params.baseUrl}/api`,
			}),
		],
	});
}

export type ApiClient = ReturnType<typeof apiClient>;
