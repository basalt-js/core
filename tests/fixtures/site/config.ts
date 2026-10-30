import { defineFramework, event } from "../../../src";
import { envService, logService } from "./services";

export type Mode = "development" | "production";

/** Step 1: the "site" framework (port of the Moku sandbox demo). */
export const site = defineFramework("site", {
  config: { siteName: "Untitled", mode: "development" as Mode },
  events: {
    "page:render": event<{ path: string; html: string }>("A page finished rendering")
  },
  services: [envService, logService]
});

/** Define a plugin for the `site` framework. */
export const definePlugin = site.definePlugin;
