import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { type AppStatus, defineFramework, defineService, event } from "../../src";
import { blogPlugin } from "../fixtures/site/consumer/blog";
import {
  analyticsPlugin,
  createApp,
  definePlugin,
  routerPlugin,
  seoPlugin,
  site,
  templateEnginePlugin
} from "../fixtures/site/index";

describe("App", () => {
  it("mounts typed plugin and service APIs", async () => {
    const app = await createApp();
    expectTypeOf(app.router.navigate).toEqualTypeOf<(path: string) => string[]>();
    expectTypeOf(app.sitemap.getEntryCount).toEqualTypeOf<() => number>();
    expectTypeOf(app.log.lines).toEqualTypeOf<() => readonly string[]>();
    expectTypeOf(app.global).toEqualTypeOf<
      Readonly<{ siteName: string; mode: "development" | "production" }>
    >();
    expectTypeOf(app.status).toEqualTypeOf<AppStatus>();
    expectTypeOf(app.start).toEqualTypeOf<() => Promise<void>>();
    expectTypeOf(app).not.toHaveProperty("nonExistent");
  });

  it("adds consumer plugins and leaves out plugins without an API", async () => {
    const silent = definePlugin("silent", { onInit: () => {} });
    const app = await createApp({ plugins: [blogPlugin, silent] });
    expectTypeOf(app.blog.listPosts).toEqualTypeOf<() => Array<{ title: string; slug: string }>>();
    expectTypeOf(app).not.toHaveProperty("silent");
  });

  it("types app.emit with every event in the app (Q10)", async () => {
    const app = await createApp();
    app.emit("page:render", { path: "/", html: "" });
    app.emit("router:navigate", { from: "/", to: "/a" });
    app.emit("sitemap:generated", { url: "", entryCount: 0 });
    // @ts-expect-error -- unknown event
    app.emit("nope:x", {});
    // @ts-expect-error -- wrong payload
    app.emit("router:navigate", { from: 1, to: "/" });
  });

  it("restricts app.get to plugins in the app; find accepts any plugin", async () => {
    const app = await createApp();
    expectTypeOf(app.get(routerPlugin).current).toEqualTypeOf<() => string>();
    expectTypeOf(app.find(blogPlugin)).toEqualTypeOf<
      (typeof blogPlugin)["_phantom"]["api"] | undefined
    >();
    // @ts-expect-error -- blog is not in this app
    app.get(blogPlugin);
  });

  it("types callback contexts with the app's plugins", async () => {
    await createApp({
      plugins: [blogPlugin],
      onReady: ctx => {
        expectTypeOf(ctx.blog.addPost).toBeFunction();
        expectTypeOf(ctx.seo.getDefaultTitle).toEqualTypeOf<() => string>();
      },
      onError: (error, ctx) => {
        expectTypeOf(error.code).toBeString();
        expectTypeOf(ctx.router.current).toBeFunction();
      }
    });
  });
});

describe("createApp options", () => {
  it("types global config and plugin overrides (Q12 for the consumer side)", async () => {
    await createApp({
      config: { mode: "production" },
      pluginConfigs: { router: { basePath: "/b" } }
    });
    // @ts-expect-error -- not a global config key
    await createApp({ config: { siteNam: "x" } });
    // @ts-expect-error -- wrong value type
    await createApp({ config: { mode: "staging" } });
    // @ts-expect-error -- unknown plugin
    await createApp({ pluginConfigs: { rooter: {} } });
    // @ts-expect-error -- wrong field type
    await createApp({ pluginConfigs: { seo: { defaultTitle: 123 } } });
    // @ts-expect-error -- templateEngine overrides only accept its fields
    await createApp({ pluginConfigs: { templateEngine: { basePath: "/" } } });
    // @ts-expect-error -- unknown option
    await createApp({ tracer: () => {} });
    expectTypeOf(templateEnginePlugin.name).toEqualTypeOf<"templateEngine">();
  });

  it("covers services in pluginConfigs", async () => {
    await createApp({ pluginConfigs: { env: { nodeEnv: "production" }, log: { level: "debug" } } });
    // @ts-expect-error -- wrong service field type
    await createApp({ pluginConfigs: { log: { level: "trace" } } });
  });

  it("requires schema fields that have no default (O15)", async () => {
    // @ts-expect-error -- pluginConfigs.analytics.trackingId is required
    await createApp({ plugins: [analyticsPlugin] });
    await createApp({
      plugins: [analyticsPlugin],
      // @ts-expect-error -- trackingId is still missing
      pluginConfigs: { analytics: { sampleRate: 1 } }
    });
    const app = await createApp({
      plugins: [analyticsPlugin],
      pluginConfigs: { analytics: { trackingId: "G-1" } }
    });
    expectTypeOf(app.analytics.trackingId).toEqualTypeOf<() => string>();
  });

  it("drops the requirement when compose supplies the field", async () => {
    const supplied = site.compose({
      plugins: [routerPlugin, analyticsPlugin],
      pluginConfigs: { analytics: { trackingId: "G-fw" } }
    });
    await supplied.createApp();
    const required = site.compose({ plugins: [routerPlugin, analyticsPlugin] });
    // @ts-expect-error -- defaults need trackingId, so createApp needs options
    await required.createApp();
    await required.createApp({ pluginConfigs: { analytics: { trackingId: "G-app" } } });
  });

  it("requires global schema fields without defaults", async () => {
    const api = defineFramework("api", {
      config: z.object({ url: z.string(), retries: z.number().default(3) })
    });
    const { createApp: createApiApp } = { createApp: api.compose({ plugins: [] }).createApp };
    // @ts-expect-error -- config.url is required
    await createApiApp();
    // @ts-expect-error -- config.url is required
    await createApiApp({ config: { retries: 1 } });
    const app = await createApiApp({ config: { url: "https://x.dev" } });
    expectTypeOf(app.global).toEqualTypeOf<Readonly<{ url: string; retries: number }>>();
  });
});

describe("compose", () => {
  it("types framework-level overrides (Q12)", () => {
    site.compose({ plugins: [routerPlugin], pluginConfigs: { router: { basePath: "/" } } });
    // @ts-expect-error -- unknown plugin key
    site.compose({ plugins: [routerPlugin], pluginConfigs: { rooter: { basePath: "/" } } });
    // @ts-expect-error -- unknown field
    site.compose({ plugins: [routerPlugin], pluginConfigs: { router: { basPath: "/" } } });
    // @ts-expect-error -- wrong field type
    site.compose({ plugins: [routerPlugin], pluginConfigs: { router: { basePath: 1 } } });
  });

  it("rejects plugins from another framework", () => {
    const other = defineFramework("other");
    // @ts-expect-error -- foreign plugin
    site.compose({ plugins: [other.definePlugin("x", {})] });
  });
});

describe("packs", () => {
  it("flatten into typed APIs", async () => {
    const peer = definePlugin("peer", { api: () => ({ id: (): string => "p" }) });
    const stage = definePlugin("stage", {
      depends: [peer],
      events: { "stage:ready": event() },
      api: ctx => ({ lobby: () => ctx.get(peer).id() })
    });
    const pack = site.pack("roomStage", [peer, stage]);
    expectTypeOf(pack.name).toEqualTypeOf<"roomStage">();
    const app = await createApp({ plugins: [pack] });
    expectTypeOf(app.stage.lobby).toEqualTypeOf<() => string>();
    expectTypeOf(app.peer.id).toEqualTypeOf<() => string>();
    app.emit("stage:ready");
  });
});

describe("defineFramework", () => {
  it("infers config, events and services", () => {
    const counter = defineService("counter", { api: () => ({ next: (): number => 1 }) });
    const fw = defineFramework("fw", {
      config: { a: 1 },
      events: { "x:y": event<string>() },
      services: [counter]
    });
    fw.definePlugin("p", {
      api: ctx => {
        expectTypeOf(ctx.global.a).toBeNumber();
        expectTypeOf(ctx.counter.next).toEqualTypeOf<() => number>();
        ctx.emit("x:y", "payload");
        return {};
      }
    });
  });

  it("rejects framework events outside domain:action", () => {
    defineFramework("bad", {
      events: {
        // @ts-expect-error -- must be "<domain>:<action>"
        render: event()
      }
    });
    defineFramework("reserved", {
      events: {
        // @ts-expect-error -- basalt: is reserved
        "basalt:status": event()
      }
    });
  });

  it("checks config against an explicit type in the curried form (O2)", () => {
    type SiteConfig = { mode: "development" | "production"; name: string };
    const typed = defineFramework<SiteConfig>()("typed", {
      config: { mode: "development", name: "x" }
    });
    typed.definePlugin("p", {
      api: ctx => {
        expectTypeOf(ctx.global.mode).toEqualTypeOf<"development" | "production">();
        return {};
      }
    });
    // @ts-expect-error -- not a SiteConfig
    defineFramework<SiteConfig>()("typed", { config: { mode: "staging", name: "x" } });
  });

  it("types serviceConfigs", () => {
    const env = defineService("env", { config: { region: "eu" } });
    defineFramework("ok", { services: [env], serviceConfigs: { env: { region: "us" } } });
    // @ts-expect-error -- unknown service
    defineFramework("bad", { services: [env], serviceConfigs: { log: {} } });
  });

  it("types service contexts with their dependencies", () => {
    const env = defineService("env", {
      config: { region: "eu" },
      api: ({ config }) => ({ region: () => config.region })
    });
    defineService("log", {
      depends: [env],
      api: ctx => {
        expectTypeOf(ctx.env.region).toEqualTypeOf<() => string>();
        return {};
      }
    });
    defineService("orphan", {
      api: ctx => {
        expectTypeOf(ctx).not.toHaveProperty("env");
        return {};
      }
    });
    expectTypeOf(seoPlugin.name).toEqualTypeOf<"seo">();
  });
});
