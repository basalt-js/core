import type { PluginCtx } from "../../../../src";

export type RouterConfig = { basePath: string; notFoundPath: string };

export type NavigationGuard = (to: string, from: string) => boolean;

export type RouterState = {
  currentPath: string;
  history: string[];
  guards: NavigationGuard[];
  initialized: boolean;
};

export type NavigationResult = { from: string; to: string; blocked: boolean };

export type RouterEvents = {
  "router:navigate": { from: string; to: string };
  "router:notFound": { path: string };
};

/** Extracted-domain-file context: named fields, nothing positional. */
export type RouterCtx = PluginCtx<{
  config: RouterConfig;
  state: RouterState;
  events: RouterEvents;
}>;
