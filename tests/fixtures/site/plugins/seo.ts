import { definePlugin } from "../config";
import { rendererPlugin } from "./renderer";

export const seoPlugin = definePlugin("seo", {
  config: { defaultTitle: "Untitled" },
  depends: [rendererPlugin],
  state: () => ({ titles: new Map<string, string>() }),
  api: ctx => ({
    setTitle: (path: string, title: string) => {
      ctx.state.titles.set(path, title);
    },
    titleFor: (path: string) => ctx.state.titles.get(path) ?? ctx.config.defaultTitle,
    getDefaultTitle: () => `${ctx.config.defaultTitle} | ${ctx.global.siteName}`
  }),
  hooks: ctx => ({
    "renderer:complete": ({ path }) => {
      ctx.log.debug(`seo saw ${path}`);
    }
  })
});
