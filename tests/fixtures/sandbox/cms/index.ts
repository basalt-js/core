import { z } from "zod";
import { event, type PluginCtx } from "../../../../src";
import { definePlugin } from "../config";
import { routerPlugin } from "../router";

type CmsEvents = {
  "cms:publish": { id: string; title: string };
  "cms:upload": { id: string; size: number };
};

type Content = { id: string; title: string; published: boolean };

type CmsState = { content: Map<string, Content>; media: Map<string, number>; nextId: number };

type CmsCtx = PluginCtx<{
  config: { maxUploadSize: number };
  state: CmsState;
  events: CmsEvents;
  depends: readonly [typeof routerPlugin];
}>;

/** Content module. */
const createContentApi = (ctx: CmsCtx) => ({
  create: (title: string): Content => {
    const item = { id: `c${ctx.state.nextId++}`, title, published: false };
    ctx.state.content.set(item.id, item);
    return item;
  },
  publish: (id: string): void => {
    const item = ctx.state.content.get(id);
    if (!item) throw new Error(`No content ${id}`);
    item.published = true;
    ctx.emit("cms:publish", { id, title: item.title });
    ctx.get(routerPlugin).navigate(`/content/${id}`);
  },
  get: (id: string): Content | undefined => ctx.state.content.get(id)
});

/** Media module. */
const createMediaApi = (ctx: CmsCtx) => ({
  upload: (size: number): string | undefined => {
    if (size > ctx.config.maxUploadSize) return undefined;
    const id = `m${ctx.state.nextId++}`;
    ctx.state.media.set(id, size);
    ctx.emit("cms:upload", { id, size });
    return id;
  }
});

/** Very complex tier: namespaced API composed from modules. */
export const cmsPlugin = definePlugin("cms", {
  config: z.object({
    maxUploadSize: z
      .number()
      .positive()
      .default(10 * 1024 * 1024)
  }),
  events: event.map<CmsEvents>({
    "cms:publish": "Content published",
    "cms:upload": "Media uploaded"
  }),
  depends: [routerPlugin],
  state: (): CmsState => ({ content: new Map(), media: new Map(), nextId: 1 }),
  api: ctx => ({ content: createContentApi(ctx), media: createMediaApi(ctx) })
});
