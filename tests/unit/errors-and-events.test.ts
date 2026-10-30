/* eslint-disable unicorn/no-null -- null is a deliberate input under test here */
import { describe, expect, it } from "vitest";
import { BasaltError, event } from "../../src";
import { describeValue } from "../../src/errors";
import { buildCatalog, isEventDescriptor } from "../../src/event";
import { expectCode } from "../helpers";

describe("BasaltError", () => {
  it("formats `[id] message [CODE]` plus an indented hint", () => {
    const error = new BasaltError({
      code: "E_INVALID_STATE",
      frameworkId: "site",
      message: "Bad state.",
      hint: "Do something else.",
      plugin: "router",
      cause: "root"
    });
    expect(error.message).toBe("[site] Bad state. [E_INVALID_STATE]\n  Do something else.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BasaltError");
    expect(error.code).toBe("E_INVALID_STATE");
    expect(error.frameworkId).toBe("site");
    expect(error.plugin).toBe("router");
    expect(error.cause).toBe("root");
  });

  it("leaves cause and plugin unset when not given", () => {
    const error = new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: "x",
      message: "m",
      hint: "h"
    });
    expect("cause" in error).toBe(false);
    expect(error.plugin).toBeUndefined();
  });

  it("describes values for messages", () => {
    expect(describeValue("a")).toBe('"a"');
    expect(describeValue(null)).toBe("null");
    expect(describeValue([])).toBe("an array");
    expect(describeValue(1)).toBe("a number");
  });
});

describe("event()", () => {
  it("creates frozen notify descriptors", () => {
    const descriptor = event<{ to: string }>("Route changed");
    expect(descriptor).toEqual({ kind: "notify", description: "Route changed" });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(isEventDescriptor(descriptor)).toBe(true);
    expect(event().description).toBeUndefined();
  });

  it("rejects non-string descriptions", async () => {
    await expect(() => event(42 as unknown as string)).toFailWith("E_INVALID_SPEC");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(event)).toBe(true);
  });

  it("event.map declares every name with its description", () => {
    const events = event.map<{ "router:navigate": { to: string }; "router:ready": undefined }>({
      "router:navigate": "Route changed",
      "router:ready": "Ready"
    });
    expect(Object.keys(events)).toEqual(["router:navigate", "router:ready"]);
    expect(events["router:ready"].description).toBe("Ready");
    expect(Object.isFrozen(events)).toBe(true);
  });

  it("event.map rejects a non-object", async () => {
    await expect(() => event.map(undefined as never)).toFailWith("E_INVALID_SPEC");
  });

  it("only treats real descriptors as descriptors", () => {
    expect(isEventDescriptor({ kind: "notify", description: undefined })).toBe(false);
    expect(isEventDescriptor(null)).toBe(false);
  });
});

describe("buildCatalog", () => {
  it("normalises plugin events in declaration order", () => {
    const catalog = buildCatalog(
      "site",
      { "router:navigate": event("Route changed"), "router:ready": event() },
      "router"
    );
    expect(catalog).toEqual([
      { name: "router:navigate", kind: "notify", description: "Route changed" },
      { name: "router:ready", kind: "notify", description: undefined }
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0])).toBe(true);
  });

  it("returns an empty catalog for undefined", () => {
    expect(buildCatalog("site", undefined, "router")).toEqual([]);
  });

  it("enforces the plugin namespace (E_EVENT_NAMESPACE)", async () => {
    const error = await expectCode(
      () => buildCatalog("site", { "nav:go": event() }, "router"),
      "E_EVENT_NAMESPACE"
    );
    expect(error.message).toContain('Name it "router:<action>"');
    await expect(() => buildCatalog("site", { "router:": event() }, "router")).toFailWith(
      "E_EVENT_NAMESPACE"
    );
    await expect(() => buildCatalog("site", { "router:a b": event() }, "router")).toFailWith(
      "E_EVENT_NAMESPACE"
    );
  });

  it("enforces `domain:action` for framework events and reserves basalt:", async () => {
    expect(buildCatalog("site", { "page:render": event() }, undefined)).toHaveLength(1);
    await expect(() => buildCatalog("site", { render: event() }, undefined)).toFailWith(
      "E_EVENT_NAMESPACE"
    );
    await expect(() => buildCatalog("site", { "basalt:status": event() }, undefined)).toFailWith(
      "E_EVENT_NAMESPACE"
    );
  });

  it("rejects non-objects and non-descriptors", async () => {
    await expect(() => buildCatalog("site", [], "router")).toFailWith("E_INVALID_SPEC");
    await expect(() => buildCatalog("site", [], undefined)).toFailWith("E_INVALID_SPEC");
    await expect(() =>
      buildCatalog("site", { "router:navigate": { kind: "notify" } }, "router")
    ).toFailWith("E_INVALID_SPEC");
  });
});
