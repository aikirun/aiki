import { initTRPC } from "@trpc/server";

// deno-lint-ignore no-empty-interface
export interface Context {}

const ctx: ReturnType<typeof initTRPC["context"]> = initTRPC.context<Context>();
const t: ReturnType<typeof ctx["create"]> = ctx.create();

export const trpcRouter = t.router;
export const trpcProceduce = t.procedure;
