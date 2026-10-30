import { describe, expectTypeOf, it } from "vitest";
import { defineFramework, event, type PluginCtx } from "../../src";
import { blogPlugin } from "../fixtures/site/consumer/blog";
import { definePlugin, rendererPlugin, routerPlugin, seoPlugin } from "../fixtures/site/index";

describe("definitions", () => {
  it("keep literal names, config, API and helpers", () => {
    expectTypeOf(routerPlugin.name).toEqualTypeOf<"router">();
    expectTypeOf(routerPlugin.framework).toEqualTypeOf<"site">();
    expectTypeOf(routerPlugin._phantom.config).toEqualTypeOf<{
      basePath: string;
      trailingSlash: boolean;
    }>();
    expectTypeOf(routerPlugin.route).toEqualTypeOf<
      (path: string, view: string) => { path: string; view: string }
    >();
  });

  it("enforce the event namespace (Q14)", () => {
    definePlugin("good", { events: { "good:changed": event<number>() } });
    definePlugin("bad", {
      events: {
        // @ts-expect-error -- plugin events must be named "bad:<action>"
        "other:changed": event<number>()
      }
    });
  });

  it("type event.map from a pre-declared map", () => {
    const events = event.map<{ "a:x": { id: string }; "a:y": undefined }>({
      "a:x": "X",
      "a:y": "Y"
    });
    expectTypeOf(events["a:x"]._phantom).toEqualTypeOf<
      { readonly payload: { id: string } } | undefined
    >();
    // @ts-expect-error -- every name needs a description
    event.map<{ "a:x": number }>({});
  });

  it("reject plugins of another framework in depends (E_FOREIGN_PLUGIN)", () => {
    const other = defineFramework("other");
    const foreign = other.definePlugin("foreign", {});
    // @ts-expect-error -- foreign belongs to "other"
    definePlugin("mixed", { depends: [foreign] });
  });
});

describe("plugin context", () => {
  it("types emit with global, own and direct-dependency events only", () => {
    definePlugin("emitter", {
      events: { "emitter:done": event<{ ok: boolean }>() },
      depends: [rendererPlugin],
      api: ctx => ({
        run: () => {
          ctx.emit("page:render", { path: "/", html: "" });
          ctx.emit("emitter:done", { ok: true });
          ctx.emit("renderer:complete", { path: "/", duration: 1 });
          // @ts-expect-error -- router:navigate is not visible (router is not a dependency)
          ctx.emit("router:navigate", { from: "/", to: "/" });
          // @ts-expect-error -- wrong payload
          ctx.emit("emitter:done", { ok: "yes" });
          // @ts-expect-error -- unknown event
          ctx.emit("nope:x", {});
        }
      })
    });
  });

  it("makes the payload optional for void events", () => {
    definePlugin("pinger", {
      events: { "pinger:ping": event() },
      api: ctx => ({
        ping: () => {
          ctx.emit("pinger:ping");
          // @ts-expect-error -- void events take no payload
          ctx.emit("pinger:ping", 1);
        }
      })
    });
  });

  it("restricts get() to depends and find() to optionalDepends (O3)", () => {
    definePlugin("reader", {
      depends: [routerPlugin],
      optionalDepends: [seoPlugin],
      api: ctx => {
        expectTypeOf(ctx.get(routerPlugin).current).toEqualTypeOf<() => string>();
        expectTypeOf(ctx.find(seoPlugin)).toEqualTypeOf<
          (typeof seoPlugin)["_phantom"]["api"] | undefined
        >();
        // @ts-expect-error -- blog is not in depends
        ctx.get(blogPlugin);
        // @ts-expect-error -- router is in depends, not optionalDepends
        ctx.find(routerPlugin);
        return {};
      }
    });
  });

  it("types hook payloads and rejects unknown hook names", () => {
    definePlugin("hooker", {
      depends: [routerPlugin],
      hooks: () => ({
        "router:navigate": payload => {
          expectTypeOf(payload).toEqualTypeOf<{ from: string; to: string }>();
        },
        "page:render": ({ html }) => {
          expectTypeOf(html).toBeString();
        }
      })
    });
    definePlugin("badHooks", {
      depends: [seoPlugin],
      // @ts-expect-error -- renderer:complete is transitive (seo → renderer), so not visible
      hooks: () => ({ "renderer:complete": () => {} })
    });
  });

  it("gives each phase its context tier", () => {
    definePlugin("tiers", {
      config: { a: 1 },
      state: ctx => {
        expectTypeOf(ctx.config.a).toBeNumber();
        expectTypeOf(ctx.global.siteName).toBeString();
        expectTypeOf(ctx.log.info).toEqualTypeOf<(message: string) => void>();
        expectTypeOf(ctx).not.toHaveProperty("emit");
        return { count: 0 };
      },
      api: ctx => {
        // @ts-expect-error -- global config is readonly
        ctx.global.siteName = "x";
        // @ts-expect-error -- plugin config is readonly
        ctx.config.a = 2;
        ctx.state.count++;
        return {};
      },
      onStop: ctx => {
        expectTypeOf(ctx.state.count).toBeNumber();
        expectTypeOf(ctx.env.isDev).toBeFunction();
        expectTypeOf(ctx).not.toHaveProperty("emit");
        expectTypeOf(ctx).not.toHaveProperty("get");
      }
    });
  });

  it("accepts async onInit and onStart", () => {
    definePlugin("async", {
      onInit: async () => {},
      onStart: async () => {},
      onStop: async () => {}
    });
  });
});

describe("PluginCtx (extracted domain files)", () => {
  type CounterCtx = PluginCtx<{
    config: { step: number };
    state: { count: number };
    events: { "counter:changed": number };
    depends: readonly [typeof routerPlugin];
  }>;
  const createCounterApi = (ctx: CounterCtx) => ({
    increment: () => {
      ctx.state.count += ctx.config.step;
      ctx.emit("counter:changed", ctx.state.count);
      ctx.get(routerPlugin).navigate("/");
    }
  });

  it("accepts the real plugin context", () => {
    const counter = definePlugin("counter", {
      config: { step: 1 },
      events: { "counter:changed": event<number>() },
      depends: [routerPlugin],
      state: () => ({ count: 0 }),
      api: ctx => createCounterApi(ctx)
    });
    expectTypeOf(counter._phantom.api.increment).toEqualTypeOf<() => void>();
  });

  it("rejects a context whose events don't match", () => {
    definePlugin("mismatch", {
      config: { step: 1 },
      events: { "mismatch:changed": event<number>() },
      depends: [routerPlugin],
      state: () => ({ count: 0 }),
      // @ts-expect-error -- this context can't emit counter:changed
      api: ctx => createCounterApi(ctx)
    });
  });
});
