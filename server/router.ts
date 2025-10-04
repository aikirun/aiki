import { trpcRouter } from "./context.ts";
import { workflowRunRouter } from "./controller/workflow-run.ts";

export const appRouter = trpcRouter({
    workflowRun: workflowRunRouter,
});

export type AppRouter = typeof appRouter;