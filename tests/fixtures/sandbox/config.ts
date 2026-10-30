import { defineFramework, event } from "../../../src";
import { envService } from "../site/services";

/** The Moku sandbox's plugin-tier framework, ported. */
export const sandbox = defineFramework("sandbox", {
  config: { appName: "sandbox" },
  events: {
    "app:error": event<{ message: string; code: number }>("An application error occurred")
  },
  services: [envService]
});

export const definePlugin = sandbox.definePlugin;
