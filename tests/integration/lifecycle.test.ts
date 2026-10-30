import { describe, expect, it } from "vitest";
import { defineFramework, defineService } from "../../src";
import { expectCode } from "../helpers";

/** A framework with two services and three plugins that log every lifecycle step. */
function trackedFramework(order: string[]) {
  const service = (name: string) =>
    defineService(name, {
      state: () => {
        order.push(`${name}:state`);
        return {};
      },
      api: () => {
        order.push(`${name}:api`);
        return { ping: () => name };
      },
      onInit: () => {
        order.push(`${name}:init`);
      },
      onStart: () => {
        order.push(`${name}:start`);
      },
      onStop: () => {
        order.push(`${name}:stop`);
      }
    });
  const framework = defineFramework("test", { services: [service("svcA"), service("svcB")] });
  const plugin = (name: string) =>
    framework.definePlugin(name, {
      state: () => {
        order.push(`${name}:state`);
        return {};
      },
      api: () => {
        order.push(`${name}:api`);
        return { ping: () => name };
      },
      hooks: () => {
        order.push(`${name}:hooks`);
        return {};
      },
      onInit: async () => {
        await Promise.resolve();
        order.push(`${name}:init`);
      },
      onStart: async () => {
        await Promise.resolve();
        order.push(`${name}:start`);
      },
      onStop: async () => {
        await Promise.resolve();
        order.push(`${name}:stop`);
      }
    });
  const composed = framework.compose({
    plugins: [plugin("a"), plugin("b"), plugin("c")],
    onReady: () => {
      order.push("framework:ready");
    },
    onStart: () => {
      order.push("framework:start");
    },
    onStop: () => {
      order.push("framework:stop");
    }
  });
  return { framework, composed };
}

describe("lifecycle order", () => {
  it("init runs in createApp: services, then states, then all APIs, then all hooks, then onInit", async () => {
    const order: string[] = [];
    const { composed } = trackedFramework(order);
    await composed.createApp({
      onReady: () => {
        order.push("app:ready");
      }
    });
    expect(order).toEqual([
      "svcA:state",
      "svcA:api",
      "svcA:init",
      "svcB:state",
      "svcB:api",
      "svcB:init",
      "a:state",
      "b:state",
      "c:state",
      "a:api",
      "b:api",
      "c:api",
      "a:hooks",
      "b:hooks",
      "c:hooks",
      "a:init",
      "b:init",
      "c:init",
      "framework:ready",
      "app:ready"
    ]);
  });

  it("start runs forward; stop runs callbacks first, then plugins and services in reverse", async () => {
    const order: string[] = [];
    const { composed } = trackedFramework(order);
    const app = await composed.createApp({
      onStart: () => {
        order.push("app:start");
      },
      onStop: () => {
        order.push("app:stop");
      }
    });
    order.length = 0;

    await app.start();
    expect(order).toEqual([
      "svcA:start",
      "svcB:start",
      "a:start",
      "b:start",
      "c:start",
      "framework:start",
      "app:start"
    ]);
    order.length = 0;

    await app.stop();
    expect(order).toEqual([
      "app:stop",
      "framework:stop",
      "c:stop",
      "b:stop",
      "a:stop",
      "svcB:stop",
      "svcA:stop"
    ]);
  });

  it("awaits async onInit before createApp resolves (Q3)", async () => {
    const framework = defineFramework("test", {});
    let loaded = false;
    const loader = framework.definePlugin("loader", {
      onInit: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        loaded = true;
      }
    });
    await framework.compose({ plugins: [loader] }).createApp();
    expect(loaded).toBe(true);
  });

  it("rejects createApp when onInit fails, returning no app", async () => {
    const framework = defineFramework("test", {});
    const broken = framework.definePlugin("broken", {
      onInit: () => {
        throw new Error("cannot load");
      }
    });
    await expect(framework.compose({ plugins: [broken] }).createApp()).rejects.toThrow(
      "cannot load"
    );
  });
});

describe("lifecycle states", () => {
  const framework = defineFramework("test", {});
  const createApp = framework.compose({ plugins: [] }).createApp;

  it("moves ready → starting → running → stopping → stopped", async () => {
    const seen: string[] = [];
    const watcher = framework.definePlugin("watcher", {
      onStart: () => {
        seen.push("onStart");
      },
      onStop: () => {
        seen.push("onStop");
      }
    });
    const app = await createApp({ plugins: [watcher] });
    expect(app.status).toBe("ready");
    const starting = app.start();
    expect(app.status).toBe("starting");
    await starting;
    expect(app.status).toBe("running");
    const stopping = app.stop();
    expect(app.status).toBe("stopping");
    await stopping;
    expect(app.status).toBe("stopped");
    expect(seen).toEqual(["onStart", "onStop"]);
  });

  it("returns the in-flight promise for a second start() while starting", async () => {
    let starts = 0;
    const counter = framework.definePlugin("counter", {
      onStart: () => {
        starts++;
      }
    });
    const app = await createApp({ plugins: [counter] });
    const first = app.start();
    expect(app.start()).toBe(first);
    await first;
    expect(starts).toBe(1);
  });

  it("rejects start() in any other state with E_INVALID_STATE", async () => {
    const app = await createApp();
    await app.start();
    await expect(() => app.start()).toFailWith("E_INVALID_STATE");
    await app.stop();
    await expect(() => app.start()).toFailWith("E_INVALID_STATE");
  });

  it("stop() is idempotent and never throws E_INVALID_STATE", async () => {
    let stops = 0;
    const counter = framework.definePlugin("counter", {
      onStop: () => {
        stops++;
      }
    });
    const app = await createApp({ plugins: [counter] });
    await app.start();
    const first = app.stop();
    expect(app.stop()).toBe(first);
    await first;
    await app.stop();
    expect(stops).toBe(1);
  });

  it("stop() from ready goes straight to stopped without calling onStop", async () => {
    let stops = 0;
    const counter = framework.definePlugin("counter", {
      onStop: () => {
        stops++;
      }
    });
    const app = await createApp({ plugins: [counter] });
    await app.stop();
    expect(app.status).toBe("stopped");
    expect(stops).toBe(0);
  });

  it("stop() during starting waits for start, then stops", async () => {
    const order: string[] = [];
    const slow = framework.definePlugin("slow", {
      onStart: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        order.push("started");
      },
      onStop: () => {
        order.push("stopped");
      }
    });
    const app = await createApp({ plugins: [slow] });
    const starting = app.start();
    await app.stop();
    await starting;
    expect(order).toEqual(["started", "stopped"]);
    expect(app.status).toBe("stopped");
  });

  it("start failure rejects with E_START_FAILED naming the target and moves to failed", async () => {
    const broken = framework.definePlugin("broken", {
      onStart: () => {
        throw new Error("port in use");
      }
    });
    const app = await createApp({ plugins: [broken] });
    const error = await expectCode(() => app.start(), "E_START_FAILED");
    expect(error.plugin).toBe("broken");
    expect((error.cause as Error).message).toBe("port in use");
    expect(app.status).toBe("failed");
    await app.stop();
    expect(app.status).toBe("failed");
  });

  it("stop() during a start that fails resolves without stopping", async () => {
    const broken = framework.definePlugin("broken", {
      onStart: async () => {
        await Promise.resolve();
        throw new Error("nope");
      }
    });
    const app = await createApp({ plugins: [broken] });
    const starting = app.start();
    await app.stop();
    await expect(starting).rejects.toThrow();
    expect(app.status).toBe("failed");
  });

  it("names consumer callbacks as start targets", async () => {
    const app = await createApp({
      onStart: () => {
        throw new Error("x");
      }
    });
    const error = await expectCode(() => app.start(), "E_START_FAILED");
    expect(error.plugin).toBe("createApp.onStart");
  });

  it("stop failure rejects with E_STOP_FAILED and still ends stopped", async () => {
    const broken = framework.definePlugin("broken", {
      onStop: () => {
        throw new Error("flush failed");
      }
    });
    const app = await createApp({ plugins: [broken] });
    await app.start();
    const error = await expectCode(() => app.stop(), "E_STOP_FAILED");
    expect(error.plugin).toBe("broken");
    expect(app.status).toBe("stopped");
  });
});

describe("context tiers (§24)", () => {
  const log = defineService("log", {
    config: { level: "info" },
    state: ctx => {
      expect(Object.keys(ctx).toSorted()).toEqual(["config", "global"]);
      return { lines: [] as string[] };
    },
    api: ctx => {
      expect(Object.keys(ctx).toSorted()).toEqual(["config", "global", "state"]);
      return {
        info: (line: string) => {
          ctx.state.lines.push(line);
        }
      };
    }
  });
  const framework = defineFramework("test", { config: { siteName: "x" }, services: [log] });

  it("gives each phase the documented context", async () => {
    const keys: Record<string, string[]> = {};
    const probe = framework.definePlugin("probe", {
      config: { a: 1 },
      state: ctx => {
        keys.state = Object.keys(ctx).toSorted();
        return { n: 0 };
      },
      api: ctx => {
        keys.api = Object.keys(ctx).toSorted();
        return {};
      },
      hooks: ctx => {
        keys.hooks = Object.keys(ctx).toSorted();
        return {};
      },
      onInit: ctx => {
        keys.onInit = Object.keys(ctx).toSorted();
        expect(Object.isFrozen(ctx)).toBe(true);
        expect(ctx.global.siteName).toBe("x");
        expect(ctx.config.a).toBe(1);
        ctx.log.info("from plugin");
      },
      onStop: ctx => {
        keys.onStop = Object.keys(ctx).toSorted();
      }
    });
    const app = await framework.compose({ plugins: [probe] }).createApp({
      onReady: ctx => {
        keys.app = Object.keys(ctx).toSorted();
      }
    });
    await app.start();
    await app.stop();
    const full = ["config", "emit", "find", "get", "global", "has", "log", "state"];
    expect(keys).toEqual({
      state: ["config", "global", "log"],
      api: full,
      hooks: full,
      onInit: full,
      onStop: ["config", "global", "log", "state"],
      app: ["emit", "find", "get", "global", "has", "log", "probe"]
    });
  });
});
