import { initTRPC } from "@trpc/server";

// deno-lint-ignore no-empty-interface
export interface Context {}

const t = initTRPC.context<Context>().create();

export const trpcRouter = t.router;
export const trpcProceduce = t.procedure;
