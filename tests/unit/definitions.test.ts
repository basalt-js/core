/* eslint-disable unicorn/no-null -- null is a deliberate input under test here */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFramework, defineService, event } from "../../src";
import { expectCode } from "../helpers";

const site = defineFramework("site", {});
const other = defineFramework("other", {});
const definePlugin = site.definePlugin as (name: unknown, spec: unknown) => Record<string, unknown>;

describe("definePlugin names (Q16)", () => {
  it.each(["b-events", "Router", "1router", "router name", ""])("rejects %j", async name => {
    await expect(() => definePlugin(name, {})).toFailWith("E_INVALID_NAME");
  });

  it.each([
    "emit",
    "config",
    "basalt",
    "toString",
    "constructor",
    "hasOwnProperty"
  ])("rejects the reserved name %j", async name => {
    const error = await expectCode(() => definePlugin(name, {}), "E_INVALID_NAME");
    expect(error.message).toContain("is reserved");
  });

  it("rejects non-string names", async () => {
    const error = await expectCode(() => definePlugin(5, {}), "E_INVALID_NAME");
    expect(error.message).toContain("Plugin name (a number) is not a valid identifier.");
  });
});

describe("definePlugin spec validation", () => {
  it("requires a plain object spec", async () => {
    await expect(() => definePlugin("router", null)).toFailWith("E_INVALID_SPEC");
    await expect(() => definePlugin("router", [])).toFailWith("E_INVALID_SPEC");
  });

  it("rejects unknown fields, with a hint for renamed Moku fields", async () => {
    const renamed = await expectCode(
      () => definePlugin("router", { createState: () => ({}) }),
      "E_INVALID_SPEC"
    );
    expect(renamed.message).toContain('Did you mean "state"?');
    const unknown = await expectCode(() => definePlugin("router", { nope: 1 }), "E_INVALID_SPEC");
    expect(unknown.message).toContain("Allowed fields:");
  });

  it("rejects a config that is neither defaults nor a schema", async () => {
    await expect(() => definePlugin("router", { config: "x" })).toFailWith("E_INVALID_SPEC");
  });

  it("rejects non-function lifecycle fields", async () => {
    for (const field of ["state", "api", "hooks", "onInit", "onStart", "onStop"]) {
      await expect(() => definePlugin("router", { [field]: {} })).toFailWith("E_INVALID_SPEC");
    }
  });

  it("validates events and depends", async () => {
    await expect(() => definePlugin("router", { events: { "nav:go": event() } })).toFailWith(
      "E_EVENT_NAMESPACE"
    );
    await expect(() => definePlugin("seo", { depends: "router" })).toFailWith("E_INVALID_SPEC");
    await expect(() => definePlugin("seo", { depends: [{ name: "router" }] })).toFailWith(
      "E_INVALID_SPEC"
    );
    await expect(() => definePlugin("seo", { optionalDepends: [null] })).toFailWith(
      "E_INVALID_SPEC"
    );
    const foreign = other.definePlugin("router", {});
    await expect(() => definePlugin("seo", { depends: [foreign] })).toFailWith("E_FOREIGN_PLUGIN");
  });

  it("validates helpers", async () => {
    await expect(() => definePlugin("router", { helpers: [] })).toFailWith("E_INVALID_SPEC");
    const notFunction = await expectCode(
      () => definePlugin("router", { helpers: { route: 1 } }),
      "E_INVALID_SPEC"
    );
    expect(notFunction.message).toContain("must be a function");
    const collision = await expectCode(
      () => definePlugin("router", { helpers: { spec: () => 1 } }),
      "E_INVALID_SPEC"
    );
    expect(collision.message).toContain("collides with a definition field");
  });
});

describe("plugin definitions", () => {
  const router = site.definePlugin("router", {
    config: { basePath: "/", nested: { deep: true } },
    events: { "router:navigate": event<{ to: string }>("Route changed") },
    api: () => ({}),
    helpers: { route: (path: string) => ({ path }) }
  });
  const seo = site.definePlugin("seo", { depends: [router], optionalDepends: [router] });

  it("is a deep-frozen plain object with kind, framework, name, spec and catalog", () => {
    expect(router.kind).toBe("plugin");
    expect(router.framework).toBe("site");
    expect(router.name).toBe("router");
    expect(router.catalog).toEqual([
      { name: "router:navigate", kind: "notify", description: "Route changed" }
    ]);
    expect(Object.isFrozen(router)).toBe(true);
    expect(Object.isFrozen(router.spec)).toBe(true);
    expect(Object.isFrozen((router.spec.config as { nested: object }).nested)).toBe(true);
    expect(Object.isFrozen(router._phantom)).toBe(true);
  });

  it("spreads helpers onto the definition", () => {
    expect(router.route("/a")).toEqual({ path: "/a" });
  });

  it("stores dependencies by identity", () => {
    expect(seo.spec.depends).toEqual([router]);
    expect(seo.spec.optionalDepends).toEqual([router]);
    expect(Object.isFrozen(seo.spec.depends)).toBe(true);
  });

  it("doesn't freeze schemas", () => {
    const schema = z.object({ a: z.string().default("x") });
    site.definePlugin("withSchema", { config: schema });
    expect(Object.isFrozen(schema)).toBe(false);
  });
});

describe("defineService", () => {
  const define = defineService as unknown as (name: unknown, spec: unknown) => object;

  it("creates a frozen definition", () => {
    const log = defineService("log", { config: { level: "info" }, api: () => ({}) });
    expect(log.kind).toBe("service");
    expect(log.name).toBe("log");
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log.spec)).toBe(true);
  });

  it("rejects bad names, specs and fields", async () => {
    await expect(() => define("log-service", {})).toFailWith("E_INVALID_NAME");
    await expect(() => define("log", 1)).toFailWith("E_INVALID_SPEC");
    await expect(() => define("log", { createState: () => ({}) })).toFailWith("E_INVALID_SPEC");
    await expect(() => define("log", { config: 1 })).toFailWith("E_INVALID_SPEC");
    await expect(() => define("log", { api: 1 })).toFailWith("E_INVALID_SPEC");
  });

  it("rejects events and hooks: services sit below the event graph", async () => {
    const events = await expectCode(() => define("log", { events: {} }), "E_INVALID_SPEC");
    expect(events.message).toContain("below the event graph");
    await expect(() => define("log", { hooks: () => ({}) })).toFailWith("E_INVALID_SPEC");
  });

  it("only depends on services", async () => {
    await expect(() => define("log", { depends: {} })).toFailWith("E_INVALID_SPEC");
    await expect(() => define("log", { depends: [site.definePlugin("x", {})] })).toFailWith(
      "E_INVALID_SPEC"
    );
    await expect(() => define("log", { depends: ["env"] })).toFailWith("E_INVALID_SPEC");
  });
});

describe("defineFramework", () => {
  const define = defineFramework as unknown as (id: unknown, options?: unknown) => object;

  it("returns a frozen framework", () => {
    const framework = defineFramework("my-site");
    expect(framework.id).toBe("my-site");
    expect(Object.isFrozen(framework)).toBe(true);
    expect(Object.keys(framework).toSorted()).toEqual([
      "_phantom",
      "compose",
      "definePlugin",
      "id",
      "pack"
    ]);
  });

  it("supports the curried form", () => {
    const framework = defineFramework<{ siteName: string }>()("site", {
      config: { siteName: "x" }
    });
    expect(framework.id).toBe("site");
  });

  it("validates the id and options", async () => {
    await expect(() => define("My Site")).toFailWith("E_INVALID_NAME");
    await expect(() => define(1)).toFailWith("E_INVALID_NAME");
    await expect(() => define("site", 1)).toFailWith("E_INVALID_SPEC");
    await expect(() => define("site", { plugins: [] })).toFailWith("E_INVALID_SPEC");
    await expect(() => define("site", { config: 1 })).toFailWith("E_INVALID_SPEC");
    await expect(() => define("site", { events: { render: event() } })).toFailWith(
      "E_EVENT_NAMESPACE"
    );
  });

  it("validates the service list", async () => {
    const env = defineService("env", { config: { nodeEnv: "dev" } });
    const log = defineService("log", { depends: [env] });
    const otherEnv = defineService("env", {});
    expect(() => define("site", { services: [env, log] })).not.toThrow();
    await expect(() => define("site", { services: env })).toFailWith("E_INVALID_SPEC");
    await expect(() => define("site", { services: [{}] })).toFailWith("E_INVALID_SPEC");
    await expect(() => define("site", { services: [env, otherEnv] })).toFailWith(
      "E_DUPLICATE_NAME"
    );
    await expect(() => define("site", { services: [log, env] })).toFailWith("E_DEPENDENCY_ORDER");
    await expect(() => define("site", { services: [log] })).toFailWith("E_DEPENDENCY_MISSING");
    await expect(() => define("site", { services: [otherEnv, log] })).toFailWith(
      "E_DEPENDENCY_MISSING"
    );
  });

  it("validates serviceConfigs keys", async () => {
    const env = defineService("env", { config: { nodeEnv: "dev" } });
    const bare = defineService("bare", {});
    expect(() =>
      define("site", { services: [env], serviceConfigs: { env: { nodeEnv: "prod" } } })
    ).not.toThrow();
    await expect(() =>
      define("site", { services: [env], serviceConfigs: { nope: {} } })
    ).toFailWith("E_CONFIG_INVALID");
    await expect(() =>
      define("site", { services: [bare], serviceConfigs: { bare: {} } })
    ).toFailWith("E_CONFIG_INVALID");
    await expect(() => define("site", { serviceConfigs: [] })).toFailWith("E_CONFIG_INVALID");
  });
});

describe("framework.pack", () => {
  const a = site.definePlugin("packA", {});
  const b = site.definePlugin("packB", {});
  const pack = site.pack as unknown as (name: unknown, plugins: unknown) => object;

  it("creates a frozen pack", () => {
    const created = site.pack("roomStage", [a, b]);
    expect(created).toEqual({
      kind: "pack",
      framework: "site",
      name: "roomStage",
      plugins: [a, b]
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.plugins)).toBe(true);
  });

  it("validates name, list, nesting and framework", async () => {
    await expect(() => pack("room-stage", [a])).toFailWith("E_INVALID_NAME");
    await expect(() => pack("stage", a)).toFailWith("E_INVALID_SPEC");
    await expect(() => pack("stage", [site.pack("inner", [a])])).toFailWith("E_INVALID_SPEC");
    await expect(() => pack("stage", [other.definePlugin("x", {})])).toFailWith("E_FOREIGN_PLUGIN");
    await expect(() => pack("stage", [1])).toFailWith("E_INVALID_SPEC");
  });
});
