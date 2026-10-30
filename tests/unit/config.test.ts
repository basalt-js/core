/* eslint-disable unicorn/no-null -- null is a deliberate input under test here */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StandardSchemaV1 } from "../../src";
import {
  assertConfigSpec,
  type ConfigTarget,
  isStandardSchema,
  resolveConfig
} from "../../src/config";
import { expectCode } from "../helpers";

const target: ConfigTarget = {
  frameworkId: "site",
  label: 'plugin "router"',
  plugin: "router",
  overridePath: "pluginConfigs.router"
};

/** A hand-written Standard Schema with an async validate. */
function asyncSchema(): StandardSchemaV1<{ port?: number }, { port: number }> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: async value => {
        const port = (value as { port?: unknown }).port ?? 8080;
        return typeof port === "number"
          ? { value: { port } }
          : { issues: [{ message: "Expected a number", path: [{ key: "port" }] }] };
      }
    }
  };
}

describe("isStandardSchema", () => {
  it("recognises object and function schemas", () => {
    expect(isStandardSchema(z.object({}))).toBe(true);
    const callable = Object.assign(() => {}, { "~standard": { validate: () => ({ value: 1 }) } });
    expect(isStandardSchema(callable)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isStandardSchema({ basePath: "/" })).toBe(false);
    expect(isStandardSchema(null)).toBe(false);
    expect(isStandardSchema("x")).toBe(false);
    expect(isStandardSchema({ "~standard": null })).toBe(false);
    expect(isStandardSchema({ "~standard": { validate: 1 } })).toBe(false);
  });
});

describe("assertConfigSpec", () => {
  it("accepts undefined, plain objects and schemas", () => {
    expect(() => assertConfigSpec(target, undefined)).not.toThrow();
    expect(() => assertConfigSpec(target, { a: 1 })).not.toThrow();
    expect(() => assertConfigSpec(target, z.object({}))).not.toThrow();
  });

  it("rejects anything else", async () => {
    const error = await expectCode(() => assertConfigSpec(target, [1]), "E_INVALID_SPEC");
    expect(error.plugin).toBe("router");
    await expect(() => assertConfigSpec({ ...target, plugin: undefined } as never, 5)).toFailWith(
      "E_INVALID_SPEC"
    );
  });
});

describe("resolveConfig with defaults", () => {
  it("shallow-merges overrides in order and freezes the result", () => {
    const defaults = { basePath: "/", nested: { a: 1, b: 2 } };
    const config = resolveConfig(target, defaults, [
      { basePath: "/fw" },
      undefined,
      { nested: { a: 9 } }
    ]);
    expect(config).toEqual({ basePath: "/fw", nested: { a: 9 } });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("returns an empty frozen object when there is no config", () => {
    const config = resolveConfig(target, undefined, []);
    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("rejects unknown keys and non-object overrides (E_CONFIG_INVALID)", async () => {
    const error = await expectCode(
      () => resolveConfig(target, { basePath: "/" }, [{ basPath: "/x" }]),
      "E_CONFIG_INVALID"
    );
    expect(error.message).toContain('basPath: not a config field of plugin "router"');
    await expect(() => resolveConfig(target, { a: 1 }, ["nope"])).toFailWith("E_CONFIG_INVALID");
  });
});

describe("resolveConfig with a schema", () => {
  const schema = z.object({
    trackingId: z.string().min(1),
    sampleRate: z.number().default(1)
  });

  it("validates synchronously, filling defaults", () => {
    const config = resolveConfig(target, schema, [{ trackingId: "G-1" }]);
    expect(config).toEqual({ trackingId: "G-1", sampleRate: 1 });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("lists every issue with its path", async () => {
    const error = await expectCode(
      () => resolveConfig(target, schema, [{ sampleRate: "x" }]),
      "E_CONFIG_INVALID"
    );
    expect(error.message).toContain(
      '[site] The config of plugin "router" is invalid. [E_CONFIG_INVALID]'
    );
    expect(error.message).toContain("Fix pluginConfigs.router:");
    expect(error.message).toContain("- trackingId:");
    expect(error.message).toContain("- sampleRate:");
  });

  it("awaits async schemas", async () => {
    await expect(resolveConfig(target, asyncSchema(), [])).resolves.toEqual({ port: 8080 });
    const error = await expectCode(
      () => resolveConfig(target, asyncSchema(), [{ port: "x" }]),
      "E_CONFIG_INVALID"
    );
    expect(error.message).toContain("- port: Expected a number");
  });

  it("reports root issues and non-object outputs", async () => {
    const rootIssue: StandardSchemaV1 = {
      "~standard": { version: 1, vendor: "t", validate: () => ({ issues: [{ message: "Bad" }] }) }
    };
    const error = await expectCode(() => resolveConfig(target, rootIssue, []), "E_CONFIG_INVALID");
    expect(error.message).toContain("- (root): Bad");

    const scalar: StandardSchemaV1 = {
      "~standard": { version: 1, vendor: "t", validate: () => ({ value: 5 }) }
    };
    await expect(() => resolveConfig(target, scalar, [])).toFailWith("E_CONFIG_INVALID");
  });
});
