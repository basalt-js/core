import type { NavigationGuard, NavigationResult, RouterCtx, RouterState } from "./types";

export const createRouterState = (ctx: { config: { basePath: string } }): RouterState => ({
  currentPath: ctx.config.basePath,
  history: [],
  guards: [],
  initialized: false
});

export const createRouterApi = (ctx: RouterCtx) => ({
  navigate: (path: string): NavigationResult => {
    const from = ctx.state.currentPath;
    if (ctx.state.guards.some(guard => !guard(path, from)))
      return { from, to: path, blocked: true };
    ctx.state.history.push(from);
    ctx.state.currentPath = path;
    ctx.emit("router:navigate", { from, to: path });
    return { from, to: path, blocked: false };
  },
  current: (): string => ctx.state.currentPath,
  back: (): string | undefined => {
    const previous = ctx.state.history.pop();
    if (previous !== undefined) {
      const from = ctx.state.currentPath;
      ctx.state.currentPath = previous;
      ctx.emit("router:navigate", { from, to: previous });
    }
    return previous;
  },
  addGuard: (guard: NavigationGuard): void => {
    ctx.state.guards.push(guard);
  },
  getHistory: (): readonly string[] => ctx.state.history
});

export const handleAppError = (ctx: RouterCtx) => (payload: { message: string; code: number }) => {
  if (payload.code === 404) {
    const from = ctx.state.currentPath;
    ctx.state.history.push(from);
    ctx.state.currentPath = ctx.config.notFoundPath;
    ctx.emit("router:notFound", { path: from });
  }
};
