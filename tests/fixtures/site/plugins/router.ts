import { event } from "../../../../src";
import { definePlugin } from "../config";

export const routerPlugin = definePlugin("router", {
  config: { basePath: "/", trailingSlash: false },
  events: {
    "router:navigate": event<{ from: string; to: string }>("Route changed")
  },
  state: ({ config }) => ({ currentPath: config.basePath, history: [] as string[] }),
  api: ctx => ({
    navigate: (path: string) => {
      const from = ctx.state.currentPath;
      ctx.state.history.push(from);
      ctx.state.currentPath = path;
      ctx.emit("router:navigate", { from, to: path });
      return ctx.state.history;
    },
    current: () => ctx.state.currentPath
  }),
  helpers: { route: (path: string, view: string) => ({ path, view }) }
});
