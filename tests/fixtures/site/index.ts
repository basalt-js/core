import { site } from "./config";
import { rendererPlugin } from "./plugins/renderer";
import { routerPlugin } from "./plugins/router";
import { seoPlugin } from "./plugins/seo";
import { sitemapPlugin } from "./plugins/sitemap";
import { templateEnginePlugin } from "./plugins/template-engine";

/** Step 2: compose the defaults. */
const composed = site.compose({
  plugins: [routerPlugin, templateEnginePlugin, rendererPlugin, seoPlugin, sitemapPlugin],
  pluginConfigs: { renderer: { template: "default" } }
});

/** Create a `site` app. */
export const createApp = composed.createApp;

export { event } from "../../../src";
export { definePlugin, site } from "./config";
export { analyticsPlugin } from "./plugins/analytics";
export { authPlugin } from "./plugins/auth";
export { rendererPlugin } from "./plugins/renderer";
export { routerPlugin } from "./plugins/router";
export { seoPlugin } from "./plugins/seo";
export { sitemapPlugin } from "./plugins/sitemap";
export { templateEnginePlugin } from "./plugins/template-engine";
