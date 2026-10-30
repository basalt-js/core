/* eslint-disable unicorn/no-null -- null is a deliberate input under test here */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFramework, defineService, event } from "../../src";
import { expectCode } from "../helpers";

describe("dependencies (§24, O3)", () => {
  const framework = defineFramework("test", {});
  const router = framework.definePlugin("router", { api: () => ({ current: () => "/" }) });
  const seo = framework.definePlugin("seo", { api: () => ({ title: () => "t" }) });
  const createApp = framework.compose({ plugins: [router] }).createApp;

  it("get() returns a declared dependency's API", async () => {
    const reader = framework.definePlugin("reader", {
      depends: [router],
      api: ctx => ({ path: () => ctx.get(router).current() })
    });
    const app = await createApp({ plugins: [reader] });
    expect(app.reader.path()).toBe("/");
  });

  it("get() of an undeclared plugin throws E_UNDECLARED_DEPENDENCY", async () => {
    const sneaky = framework.definePlugin("sneaky", {
      api: ctx => ({ peek: () => (ctx.get as (plugin: unknown) => unknown)(router) })
    });
    const app = await createApp({ plugins: [sneaky] });
    const error = await expectCode(() => app.sneaky.peek(), "E_UNDECLARED_DEPENDENCY");
    expect(error.message).toContain('ctx.get("router")');
  });

  it("get() of a non-definition names the value", async () => {
    const odd = framework.definePlugin("odd", {
      api: ctx => ({ peek: () => (ctx.get as (plugin: unknown) => unknown)("router") })
    });
    const app = await createApp({ plugins: [odd] });
    const error = await expectCode(() => app.odd.peek(), "E_UNDECLARED_DEPENDENCY");
    expect(error.message).toContain('ctx.get("router")');
  });

  it("find() returns an optional dependency's API or undefined", async () => {
    const user = framework.definePlugin("user", {
      optionalDepends: [seo],
      api: ctx => ({ title: () => ctx.find(seo)?.title() })
    });
    const without = await createApp({ plugins: [user] });
    expect(without.user.title()).toBeUndefined();
    const withSeo = await createApp({ plugins: [seo, user] });
    expect(withSeo.user.title()).toBe("t");
  });

  it("find() requires optionalDepends", async () => {
    const user = framework.definePlugin("user", {
      depends: [router],
      api: ctx => ({ find: () => (ctx.find as (plugin: unknown) => unknown)(router) })
    });
    const app = await createApp({ plugins: [user] });
    await expect(() => app.user.find()).toFailWith("E_UNDECLARED_DEPENDENCY");
  });

  it("has() accepts definitions and names, including services", async () => {
    const log = defineService("log", {});
    const withLog = defineFramework("logged", { services: [log] });
    const plugin = withLog.definePlugin("plugin", {});
    const app = await withLog.compose({ plugins: [plugin] }).createApp();
    expect(app.has(plugin)).toBe(true);
    expect(app.has("plugin")).toBe(true);
    expect(app.has(log)).toBe(true);
    expect(app.has("log")).toBe(true);
    expect(app.has(defineService("log", {}))).toBe(false);
    expect(app.has(router)).toBe(false);
    expect(app.has("nope")).toBe(false);
    expect((app.has as (value: unknown) => boolean)(null)).toBe(false);
  });

  it("app.get() reaches any plugin and throws for absent ones; app.find() returns undefined", async () => {
    const app = await createApp();
    expect(app.get(router).current()).toBe("/");
    expect(app.find(seo)).toBeUndefined();
    const error = await expectCode(
      () => (app.get as (plugin: unknown) => unknown)(seo),
      "E_DEPENDENCY_MISSING"
    );
    expect(error.message).toContain('get("seo")');
    await expect(() => (app.get as (plugin: unknown) => unknown)(1)).toFailWith(
      "E_DEPENDENCY_MISSING"
    );
  });
});

describe("plugin list validation (compose validates defaults now: Q13)", () => {
  const framework = defineFramework("test", {
    events: { "router:navigate": event() },
    services: [defineService("log", {})]
  });
  const router = framework.definePlugin("router", {});
  const seo = framework.definePlugin("seo", { depends: [router] });
  const compose = framework.compose as (options: unknown) => {
    createApp: (options?: unknown) => Promise<unknown>;
  };

  it("rejects dependency order problems at compose", async () => {
    const error = await expectCode(() => compose({ plugins: [seo, router] }), "E_DEPENDENCY_ORDER");
    expect(error.message).toBe(
      '[test] Plugin "seo" depends on "router", but "router" appears after "seo". [E_DEPENDENCY_ORDER]\n  Move "router" before "seo" in your plugin list.'
    );
  });

  it("rejects missing dependencies, by identity (Q11)", async () => {
    await expect(() => compose({ plugins: [seo] })).toFailWith("E_DEPENDENCY_MISSING");
    const impostor = framework.definePlugin("router", {});
    const error = await expectCode(
      () => compose({ plugins: [impostor, seo] }),
      "E_DEPENDENCY_MISSING"
    );
    expect(error.message).toContain("is a different definition");
  });

  it("checks optional dependency order only when present", async () => {
    const user = framework.definePlugin("user", { optionalDepends: [router] });
    expect(() => compose({ plugins: [user] })).not.toThrow();
    await expect(() => compose({ plugins: [user, router] })).toFailWith("E_DEPENDENCY_ORDER");
  });

  it("rejects duplicate names across plugins and services", async () => {
    await expect(() => compose({ plugins: [router, router] })).toFailWith("E_DUPLICATE_NAME");
    const log = framework.definePlugin("log", {});
    const error = await expectCode(() => compose({ plugins: [log] }), "E_DUPLICATE_NAME");
    expect(error.message).toContain("same name as a service");
  });

  it("rejects an app that re-adds a default plugin", async () => {
    const { createApp } = compose({ plugins: [router] });
    await expect(() => createApp({ plugins: [router] })).toFailWith("E_DUPLICATE_NAME");
  });

  it("rejects an event declared twice (E_EVENT_CONFLICT)", async () => {
    const noisy = framework.definePlugin("router", { events: { "router:navigate": event() } });
    await expect(() => compose({ plugins: [noisy] })).toFailWith("E_EVENT_CONFLICT");
  });

  it("rejects foreign plugins and packs (E_FOREIGN_PLUGIN)", async () => {
    const other = defineFramework("other", {});
    const foreign = other.definePlugin("foreign", {});
    await expect(() => compose({ plugins: [foreign] })).toFailWith("E_FOREIGN_PLUGIN");
    await expect(() => compose({ plugins: [other.pack("pack", [foreign])] })).toFailWith(
      "E_FOREIGN_PLUGIN"
    );
    const { createApp } = compose({ plugins: [] });
    await expect(() => createApp({ plugins: [foreign] })).toFailWith("E_FOREIGN_PLUGIN");
  });

  it("rejects malformed options", async () => {
    await expect(() => compose(undefined)).toFailWith("E_INVALID_SPEC");
    await expect(() => compose({ plugins: router })).toFailWith("E_INVALID_SPEC");
    await expect(() => compose({ plugins: ["router"] })).toFailWith("E_INVALID_SPEC");
    await expect(() => compose({ plugins: [], tracer: () => {} })).toFailWith("E_INVALID_SPEC");
    await expect(() => compose({ plugins: [], onReady: 1 })).toFailWith("E_INVALID_SPEC");
    const { createApp } = compose({ plugins: [] });
    await expect(() => createApp(1)).toFailWith("E_INVALID_SPEC");
    await expect(() => createApp({ plugin: [] })).toFailWith("E_INVALID_SPEC");
    await expect(() => createApp({ onStop: "x" })).toFailWith("E_INVALID_SPEC");
  });

  it("returns a frozen { createApp }", () => {
    const composed = compose({ plugins: [] });
    expect(Object.keys(composed)).toEqual(["createApp"]);
    expect(Object.isFrozen(composed)).toBe(true);
  });
});

describe("config resolution", () => {
  const env = defineService("env", { config: { nodeEnv: "development", region: "eu" } });
  const framework = defineFramework("test", {
    config: { siteName: "Untitled", mode: "development" },
    services: [env],
    serviceConfigs: { env: { nodeEnv: "framework" } }
  });
  const router = framework.definePlugin("router", {
    config: { basePath: "/", trailingSlash: false },
    api: ctx => ({ config: () => ctx.config, global: () => ctx.global })
  });
  const composed = framework.compose({
    plugins: [router],
    pluginConfigs: { router: { basePath: "/fw" }, env: { region: "us" } }
  });

  it("merges global config over defaults and freezes it", async () => {
    const app = await composed.createApp({ config: { siteName: "Blog" } });
    expect(app.global).toEqual({ siteName: "Blog", mode: "development" });
    expect(Object.isFrozen(app.global)).toBe(true);
    expect(app.router.global()).toBe(app.global);
  });

  it("merges plugin config: defaults → compose → createApp", async () => {
    const app = await composed.createApp({ pluginConfigs: { router: { trailingSlash: true } } });
    expect(app.router.config()).toEqual({ basePath: "/fw", trailingSlash: true });
    expect(Object.isFrozen(app.router.config())).toBe(true);
  });

  it("merges service config: defaults → defineFramework → compose → createApp", async () => {
    let seen: unknown;
    const probe = defineService("probe", { config: { a: 0 } });
    const withProbe = defineFramework("probed", {
      services: [env, probe],
      serviceConfigs: { env: { nodeEnv: "framework" }, probe: { a: 1 } }
    });
    const reader = withProbe.definePlugin("reader", {
      onInit: ctx => {
        seen = ctx;
      }
    });
    await withProbe
      .compose({ plugins: [reader], pluginConfigs: { env: { region: "us" } } })
      .createApp({ pluginConfigs: { env: { nodeEnv: "app" } } });
    expect(seen).toBeDefined();
    const app = await composed.createApp({ pluginConfigs: { env: { nodeEnv: "app" } } });
    expect(app.has(env)).toBe(true);
  });

  it("rejects override keys that don't name a configurable plugin or service", async () => {
    const bare = framework.definePlugin("bare", {});
    await expect(() => composed.createApp({ pluginConfigs: { nope: {} } } as never)).toFailWith(
      "E_CONFIG_INVALID"
    );
    const error = await expectCode(
      () => composed.createApp({ plugins: [bare], pluginConfigs: { bare: {} } } as never),
      "E_CONFIG_INVALID"
    );
    expect(error.message).toContain('"bare" has no config');
    await expect(() => composed.createApp({ pluginConfigs: [] } as never)).toFailWith(
      "E_CONFIG_INVALID"
    );
  });

  it("rejects unknown fields in plain configs", async () => {
    await expect(() => composed.createApp({ config: { sitename: "x" } } as never)).toFailWith(
      "E_CONFIG_INVALID"
    );
    await expect(() =>
      composed.createApp({ pluginConfigs: { router: { basPath: "/" } } } as never)
    ).toFailWith("E_CONFIG_INVALID");
  });
});

describe("schema config (§21.1)", () => {
  const framework = defineFramework("test", {
    config: z.object({ apiUrl: z.string().url(), retries: z.number().default(3) })
  });
  const analytics = framework.definePlugin("analytics", {
    config: z.object({ trackingId: z.string().min(1), sampleRate: z.number().default(1) }),
    api: ctx => ({ config: () => ctx.config })
  });
  const createApp = framework.compose({ plugins: [] }).createApp;

  it("validates, fills defaults and freezes", async () => {
    const app = await createApp({
      config: { apiUrl: "https://x.dev" },
      plugins: [analytics],
      pluginConfigs: { analytics: { trackingId: "G-1" } }
    });
    expect(app.global).toEqual({ apiUrl: "https://x.dev", retries: 3 });
    expect(app.analytics.config()).toEqual({ trackingId: "G-1", sampleRate: 1 });
    expect(Object.isFrozen(app.analytics.config())).toBe(true);
  });

  it("rejects missing required fields with E_CONFIG_INVALID naming the field", async () => {
    const error = await expectCode(
      () => createApp({ config: { apiUrl: "https://x.dev" }, plugins: [analytics] } as never),
      "E_CONFIG_INVALID"
    );
    expect(error.plugin).toBe("analytics");
    expect(error.message).toContain("pluginConfigs.analytics");
    expect(error.message).toContain("- trackingId:");
    const global = await expectCode(
      () => createApp({ config: { apiUrl: "nope" } }),
      "E_CONFIG_INVALID"
    );
    expect(global.message).toContain("The config of the global config is invalid");
  });

  it("lets the framework supply required fields in compose", async () => {
    const app = await framework
      .compose({ plugins: [analytics], pluginConfigs: { analytics: { trackingId: "G-fw" } } })
      .createApp({ config: { apiUrl: "https://x.dev" } });
    expect(app.analytics.config().trackingId).toBe("G-fw");
  });
});

describe("packs (O8)", () => {
  const framework = defineFramework("test", {});
  const peer = framework.definePlugin("peer", { api: () => ({ id: () => "peer" }) });
  const stage = framework.definePlugin("stage", {
    depends: [peer],
    api: ctx => ({ lobby: () => `lobby-${ctx.get(peer).id()}` })
  });
  const game = framework.definePlugin("game", { depends: [stage] });
  const stagePack = framework.pack("roomStage", [peer, stage]);

  it("flattens in place, keeping order", async () => {
    const order: string[] = [];
    const first = framework.definePlugin("first", {
      onInit: () => {
        order.push("first");
      }
    });
    const track = (name: string) =>
      framework.definePlugin(name, {
        onInit: () => {
          order.push(name);
        }
      });
    const pack = framework.pack("middle", [track("m1"), track("m2")]);
    await framework.compose({ plugins: [first, pack] }).createApp({ plugins: [track("last")] });
    expect(order).toEqual(["first", "m1", "m2", "last"]);
  });

  it("exposes pack plugins like any other plugin", async () => {
    const app = await framework.compose({ plugins: [] }).createApp({ plugins: [stagePack, game] });
    expect(app.stage.lobby()).toBe("lobby-peer");
    expect(app.has(peer)).toBe(true);
  });

  it("applies every rule to the flattened list", async () => {
    await expect(() => framework.compose({ plugins: [game, stagePack] })).toFailWith(
      "E_DEPENDENCY_ORDER"
    );
    await expect(() => framework.compose({ plugins: [stagePack, peer] })).toFailWith(
      "E_DUPLICATE_NAME"
    );
  });
});
