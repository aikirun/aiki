import { initTRPC } from "@trpc/server";

// deno-lint-ignore no-empty-interface
export interface Context {}

export const {
	router: trpcRouter,
	procedure: trpcProceduce,
} = initTRPC.context<Context>().create();
