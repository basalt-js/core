import { event } from "../../../../src";
import { definePlugin } from "../config";
import { createRouterApi, createRouterState, handleAppError } from "./api";
import type { RouterEvents } from "./types";

/** Standard tier: index.ts only wires; logic lives in api.ts. */
export const routerPlugin = definePlugin("router", {
  config: { basePath: "/", notFoundPath: "/404" },
  events: event.map<RouterEvents>({
    "router:navigate": "Route changed",
    "router:notFound": "Route not found"
  }),
  state: createRouterState,
  api: ctx => createRouterApi(ctx),
  hooks: ctx => ({ "app:error": handleAppError(ctx) }),
  onInit: ctx => {
    ctx.state.initialized = true;
  },
  onStart: ctx => {
    ctx.emit("router:navigate", { from: "", to: ctx.config.basePath });
  }
});
