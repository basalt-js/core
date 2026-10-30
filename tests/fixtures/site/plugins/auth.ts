import { event } from "../../../../src";
import { definePlugin } from "../config";
import { routerPlugin } from "./router";

export const authPlugin = definePlugin("auth", {
  config: { loginPath: "/login", sessionTimeout: 3600 },
  events: {
    "auth:login": event<{ userId: string }>("User logged in"),
    "auth:logout": event<{ userId: string }>("User logged out")
  },
  depends: [routerPlugin],
  state: () => ({ currentUser: undefined as string | undefined }),
  api: ctx => ({
    login: (userId: string) => {
      ctx.state.currentUser = userId;
      ctx.emit("auth:login", { userId });
    },
    logout: () => {
      const userId = ctx.state.currentUser;
      ctx.state.currentUser = undefined;
      if (userId) ctx.emit("auth:logout", { userId });
      ctx.get(routerPlugin).navigate(ctx.config.loginPath);
    },
    currentUser: () => ctx.state.currentUser,
    isAuthenticated: () => ctx.state.currentUser !== undefined
  }),
  hooks: ctx => ({
    "router:navigate": ({ to }) => {
      if (to === "/protected" && ctx.state.currentUser === undefined) {
        ctx.get(routerPlugin).navigate(ctx.config.loginPath);
      }
    }
  })
});
