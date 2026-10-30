// Moku sandbox scenarios (moku-labs/core tests/sandbox), ported to Basalt as
// acceptance tests for M1. Where Basalt deliberately differs, the test says why.

import { describe, expect, it } from "vitest";
import { cmsPlugin } from "../fixtures/sandbox/cms";
import { sandbox } from "../fixtures/sandbox/config";
import { counterPlugin } from "../fixtures/sandbox/counter";
import { routerPlugin as guardedRouterPlugin } from "../fixtures/sandbox/router";
import { blogPlugin } from "../fixtures/site/consumer/blog";
import {
  analyticsPlugin,
  authPlugin,
  createApp,
  definePlugin,
  event,
  rendererPlugin,
  routerPlugin,
  site
} from "../fixtures/site/index";

describe("factory chain (SAND-01..03)", () => {
  it("step 1 returns a frozen framework with definePlugin, pack and compose", () => {
    expect(typeof site.definePlugin).toBe("function");
    expect(typeof site.pack).toBe("function");
    expect(typeof site.compose).toBe("function");
    expect(Object.isFrozen(site)).toBe(true);
  });

  it("the definePlugin a framework re-exports is the framework's own", () => {
    expect(definePlugin).toBe(site.definePlugin);
  });

  it("createApp resolves to a frozen app with every default plugin and service API", async () => {
    const app = await createApp();
    for (const name of ["router", "templateEngine", "renderer", "seo", "sitemap", "env", "log"]) {
      expect(app).toHaveProperty(name);
    }
    expect(typeof app.start).toBe("function");
    expect(Object.isFrozen(app)).toBe(true);
  });
});

describe("3-layer flow (SAND-04)", () => {
  it("framework config → framework index → consumer, with consumer extras", async () => {
    const app = await createApp({
      plugins: [analyticsPlugin, blogPlugin],
      config: { siteName: "My Blog", mode: "production" },
      pluginConfigs: {
        router: { basePath: "/blog" },
        analytics: { trackingId: "G-XXXXX" },
        blog: { postsPerPage: 5 }
      }
    });
    await app.start();
    app.router.navigate("/about");
    app.blog.addPost("Hello", "hello");
    expect(app.blog.listPosts()).toEqual([{ title: "Hello", slug: "hello" }]);
    expect(app.blog.getPostsPerPage()).toBe(5);
    expect(app.global.siteName).toBe("My Blog");
    await app.settled();
    expect(app.analytics.getEvents()).toEqual([
      { event: "page_view", properties: { path: "/about" } }
    ]);
    await app.stop();
  });
});

describe("config resolution", () => {
  it("framework overrides apply, then consumer overrides, shallowly", async () => {
    const seen: string[] = [];
    const app = await createApp({
      pluginConfigs: { renderer: { template: "custom" } },
      plugins: [
        definePlugin("probe", {
          depends: [rendererPlugin],
          hooks: () => ({
            "page:render": ({ html }) => {
              seen.push(html);
            }
          })
        })
      ]
    });
    app.renderer.render("/x");
    await app.settled();
    expect(seen).toEqual(["<custom>/x"]);
  });

  it("required config is enforced: Moku's sentinel + onInit check becomes a schema field", async () => {
    await expect(createApp({ plugins: [analyticsPlugin] } as never)).rejects.toThrow(
      "pluginConfigs.analytics"
    );
  });
});

describe("events", () => {
  it("global events reach hooks with typed payloads", async () => {
    const received: Array<{ path: string; html: string }> = [];
    const listener = definePlugin("listener", {
      hooks: () => ({
        "page:render": payload => {
          received.push(payload);
        }
      })
    });
    const app = await createApp({ plugins: [listener] });
    app.emit("page:render", { path: "/", html: "<h1>Home</h1>" });
    // Basalt: delivery is a microtask (B5); Moku ran the first handler inside emit().
    expect(received).toHaveLength(0);
    await app.settled();
    expect(received).toEqual([{ path: "/", html: "<h1>Home</h1>" }]);
  });

  it("a dependent plugin hooks its dependency's events", async () => {
    const navigations: Array<{ from: string; to: string }> = [];
    const navListener = definePlugin("navListener", {
      depends: [routerPlugin],
      hooks: () => ({
        "router:navigate": payload => {
          navigations.push(payload);
        }
      })
    });
    const app = await createApp({ plugins: [navListener] });
    app.router.navigate("/about");
    await app.settled();
    expect(navigations).toEqual([{ from: "/", to: "/about" }]);
  });

  it("a dependent plugin can emit its dependency's events", async () => {
    const logins: string[] = [];
    const dashboard = definePlugin("dashboard", {
      depends: [authPlugin],
      api: ctx => ({ impersonate: () => ctx.emit("auth:login", { userId: "from-dashboard" }) }),
      hooks: () => ({
        "auth:login": ({ userId }) => {
          logins.push(userId);
        }
      })
    });
    const app = await createApp({ plugins: [authPlugin, dashboard] });
    app.dashboard.impersonate();
    app.auth.login("alice");
    await app.settled();
    expect(logins).toEqual(["from-dashboard", "alice"]);
  });

  it("hooks get the full plugin context (state, emit, get)", async () => {
    const source = definePlugin("source", {
      events: { "source:action": event<{ value: number }>("Source action") },
      api: ctx => ({ fire: (value: number) => ctx.emit("source:action", { value }) })
    });
    const html: string[] = [];
    const sink = definePlugin("sink", {
      depends: [source],
      state: () => ({ lastValue: 0 }),
      api: ctx => ({ last: () => ctx.state.lastValue }),
      hooks: ctx => ({
        "source:action": ({ value }) => {
          ctx.state.lastValue = value;
          ctx.emit("page:render", { path: "/hook", html: String(value) });
        },
        "page:render": payload => {
          html.push(payload.html);
        }
      })
    });
    const app = await createApp({ plugins: [source, sink] });
    app.get(source).fire(42);
    await app.settled();
    expect(app.sink.last()).toBe(42);
    expect(html).toEqual(["42"]);
  });

  it("auth redirects unauthenticated navigation through its router dependency", async () => {
    const app = await createApp({ plugins: [authPlugin] });
    app.router.navigate("/protected");
    await app.settled();
    expect(app.router.current()).toBe("/login");
    app.auth.login("bob");
    app.auth.logout();
    expect(app.auth.isAuthenticated()).toBe(false);
  });
});

describe("lifecycle callbacks see plugin APIs", () => {
  it("onReady, onStart and onStop get the app context", async () => {
    const seen: string[] = [];
    const app = await createApp({
      onReady: ctx => {
        seen.push(`ready ${ctx.router.current()} ${ctx.has("seo")}`);
      },
      onStart: ctx => {
        seen.push(`start ${ctx.seo.getDefaultTitle()}`);
      },
      // Basalt: consumer onStop runs first, while plugins are alive (fixes Q6).
      onStop: ctx => {
        seen.push(`stop ${ctx.router.current()}`);
      }
    });
    await app.start();
    await app.stop();
    expect(seen).toEqual(["ready / true", "start Untitled | Untitled", "stop /"]);
  });
});

describe("plugin tiers (sandbox/plugins)", () => {
  const createSandboxApp = sandbox.compose({ plugins: [guardedRouterPlugin] }).createApp;

  it("micro: counter respects config and keeps state private", async () => {
    const app = await createSandboxApp({
      plugins: [counterPlugin],
      pluginConfigs: { counter: { initial: 10, step: 5 } }
    });
    app.counter.increment();
    app.counter.increment();
    app.counter.decrement();
    expect(app.counter.value()).toBe(15);
    app.counter.reset();
    expect(app.counter.value()).toBe(10);
    expect(Object.keys(app.counter).toSorted()).toEqual([
      "decrement",
      "increment",
      "reset",
      "value"
    ]);
    expect("state" in app.counter).toBe(false);
  });

  it("nano: env is a service, injected on every context and mounted on the app", async () => {
    const app = await createSandboxApp({ pluginConfigs: { env: { nodeEnv: "production" } } });
    expect(app.env.isProd()).toBe(true);
    expect(app.env.isCI()).toBe(false);
  });

  it("standard: router guards, history, back, and app:error handling via extracted files", async () => {
    const app = await createSandboxApp();
    await app.start();
    await app.settled();
    app.router.addGuard(to => to !== "/admin");
    expect(app.router.navigate("/admin").blocked).toBe(true);
    expect(app.router.navigate("/a").blocked).toBe(false);
    app.router.navigate("/b");
    expect(app.router.back()).toBe("/a");
    expect(app.router.getHistory()).toEqual(["/"]);
    app.emit("app:error", { message: "Not found", code: 404 });
    await app.settled();
    expect(app.router.current()).toBe("/404");
    await app.stop();
  });

  it("very complex: cms exposes a namespaced API composed from modules", async () => {
    const published: string[] = [];
    const watcher = sandbox.definePlugin("watcher", {
      depends: [cmsPlugin],
      hooks: () => ({
        "cms:publish": ({ title }) => {
          published.push(title);
        }
      })
    });
    const app = await createSandboxApp({
      plugins: [cmsPlugin, watcher],
      pluginConfigs: { cms: { maxUploadSize: 100 } }
    });
    const post = app.cms.content.create("Hello");
    app.cms.content.publish(post.id);
    expect(app.cms.content.get(post.id)?.published).toBe(true);
    expect(app.router.current()).toBe(`/content/${post.id}`);
    expect(app.cms.media.upload(500)).toBeUndefined();
    expect(app.cms.media.upload(50)).toMatch(/^m\d+$/);
    await app.settled();
    expect(published).toEqual(["Hello"]);
  });
});
