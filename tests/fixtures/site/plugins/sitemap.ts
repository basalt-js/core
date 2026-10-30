import { event } from "../../../../src";
import { definePlugin } from "../config";
import { rendererPlugin } from "./renderer";
import { routerPlugin } from "./router";
import { seoPlugin } from "./seo";

export const sitemapPlugin = definePlugin("sitemap", {
  config: { baseUrl: "https://example.com", changeFreq: "weekly" as string },
  events: {
    "sitemap:generated": event<{ url: string; entryCount: number }>("Sitemap XML generated"),
    "sitemap:entryAdded": event<{ path: string; title: string }>("Entry added")
  },
  depends: [seoPlugin, routerPlugin, rendererPlugin],
  state: () => ({ entries: [] as Array<{ path: string; title: string; lastMod: string }> }),
  api: ctx => ({
    addEntry: (path: string) => {
      const title = ctx.get(seoPlugin).getDefaultTitle();
      const entry = { path, title, lastMod: ctx.get(routerPlugin).current() };
      ctx.state.entries.push(entry);
      ctx.emit("sitemap:entryAdded", { path, title });
      return entry;
    },
    generate: () => {
      const xml = ctx.state.entries
        .map(entry => `<url><loc>${ctx.config.baseUrl}${entry.path}</loc></url>`)
        .join("\n");
      ctx.emit("sitemap:generated", {
        url: `${ctx.config.baseUrl}/sitemap.xml`,
        entryCount: ctx.state.entries.length
      });
      return `<urlset>\n${xml}\n</urlset>`;
    },
    getEntries: () => ctx.state.entries,
    getEntryCount: () => ctx.state.entries.length
  }),
  hooks: () => ({
    // Visible because sitemap depends on renderer directly.
    "renderer:complete": () => {}
  })
});
