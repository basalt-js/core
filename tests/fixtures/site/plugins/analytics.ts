import { z } from "zod";
import { event } from "../../../../src";
import { definePlugin } from "../config";
import { routerPlugin } from "./router";

/** Opt-in plugin with a schema config: `trackingId` has no default, so apps must set it. */
export const analyticsPlugin = definePlugin("analytics", {
  config: z.object({
    trackingId: z.string().min(1),
    sampleRate: z.number().min(0).max(1).default(1),
    provider: z.enum(["console", "memory"]).default("memory")
  }),
  events: {
    "analytics:track": event<{ event: string; properties: Record<string, unknown> }>(
      "Event tracked"
    )
  },
  depends: [routerPlugin],
  state: () => ({
    events: [] as Array<{ event: string; properties: Record<string, unknown> }>
  }),
  api: ctx => ({
    track: (name: string, properties: Record<string, unknown> = {}) => {
      ctx.state.events.push({ event: name, properties });
      ctx.emit("analytics:track", { event: name, properties });
    },
    getEvents: () => ctx.state.events,
    trackingId: () => ctx.config.trackingId
  }),
  hooks: ctx => ({
    "router:navigate": ({ to }) => {
      ctx.state.events.push({ event: "page_view", properties: { path: to } });
    }
  })
});
