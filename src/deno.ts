import { ExecutionContext } from "hono";
import worker from "./worker.ts";

export default {
  async fetch(request: Request, env: Record<string, unknown>, executionCtx?: ExecutionContext) {
    env.LOG_LEVEL = Deno.env.get("LOG_LEVEL");
    env.NODE_ENV = Deno.env.get("NODE_ENV");
    env.KERNEL_PUBLIC_KEY = Deno.env.get("KERNEL_PUBLIC_KEY");
    return worker.fetch(request, env, executionCtx);
  },
};
