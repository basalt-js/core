import { event } from "../../../../src";
import { definePlugin } from "../config";
import { templateEnginePlugin } from "./template-engine";

export const rendererPlugin = definePlugin("renderer", {
  config: { template: "minimal" as string },
  events: {
    "renderer:complete": event<{ path: string; duration: number }>("A render finished")
  },
  depends: [templateEnginePlugin],
  api: ctx => ({
    render: (path: string) => {
      const html = ctx.get(templateEnginePlugin).compile(`<${ctx.config.template}>${path}`);
      ctx.emit("page:render", { path, html });
      ctx.emit("renderer:complete", { path, duration: 0 });
      return html;
    }
  })
});
