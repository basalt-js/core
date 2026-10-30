import { definePlugin } from "../config";

export const templateEnginePlugin = definePlugin("templateEngine", {
  config: { engine: "default" as string },
  api: () => ({ compile: (template: string) => template })
});
