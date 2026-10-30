import { afterEach, describe, expect, it, vi } from "vitest";
import { type BasaltError, defineFramework, event } from "../../src";
import { expectCode, spyConsoleError } from "../helpers";

const framework = defineFramework("test", {
  events: { "page:render": event<{ path: string }>("A page rendered") }
});
const createApp = framework.compose({ plugins: [] }).createApp;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emit", () => {
  it("never runs a handler inside emit() (B5); settled() waits for delivery", async () => {
    const seen: string[] = [];
    const listener = framework.definePlugin("listener", {
      hooks: () => ({
        "page:render": ({ path }) => {
          seen.push(path);
        }
      })
    });
    const app = await createApp({ plugins: [listener] });
    app.emit("page:render", { path: "/" });
    expect(seen).toEqual([]);
    await app.settled();
    expect(seen).toEqual(["/"]);
  });

  it("runs handlers in plugin order, awaiting each", async () => {
    const seen: string[] = [];
    const first = framework.definePlugin("first", {
      hooks: () => ({
        "page:render": async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          seen.push("first");
        }
      })
    });
    const second = framework.definePlugin("second", {
      hooks: () => ({
        "page:render": () => {
          seen.push("second");
        }
      })
    });
    const app = await createApp({ plugins: [first, second] });
    app.emit("page:render", { path: "/" });
    await app.settled();
    expect(seen).toEqual(["first", "second"]);
  });

  it("settled() also waits for events emitted by handlers", async () => {
    const seen: string[] = [];
    const relay = framework.definePlugin("relay", {
      events: { "relay:done": event<string>() },
      hooks: ctx => ({
        "page:render": ({ path }) => ctx.emit("relay:done", path),
        "relay:done": path => {
          seen.push(path);
        }
      })
    });
    const app = await createApp({ plugins: [relay] });
    app.emit("page:render", { path: "/a" });
    await app.settled();
    expect(seen).toEqual(["/a"]);
  });

  it("emits plugin events from the app (Q10)", async () => {
    const seen: number[] = [];
    const counter = framework.definePlugin("counter", {
      events: { "counter:changed": event<number>() },
      hooks: () => ({
        "counter:changed": value => {
          seen.push(value);
        }
      })
    });
    const app = await createApp({ plugins: [counter] });
    app.emit("counter:changed", 3);
    await app.settled();
    expect(seen).toEqual([3]);
  });

  it("supports events without a payload", async () => {
    let fired = false;
    const ping = framework.definePlugin("ping", {
      events: { "ping:now": event() },
      hooks: () => ({
        "ping:now": () => {
          fired = true;
        }
      })
    });
    const app = await createApp({ plugins: [ping] });
    app.emit("ping:now");
    await app.settled();
    expect(fired).toBe(true);
  });

  it("throws E_UNKNOWN_EVENT for undeclared names, even through casts", async () => {
    const app = await createApp();
    const emit = app.emit as (name: unknown, payload?: unknown) => void;
    await expect(() => emit("nope:x", {})).toFailWith("E_UNKNOWN_EVENT");
    await expect(() => emit(42)).toFailWith("E_UNKNOWN_EVENT");
  });

  it("throws E_EMIT_DURING_WIRING inside the api factory", async () => {
    const eager = framework.definePlugin("eager", {
      api: ctx => {
        ctx.emit("page:render", { path: "/" });
        return {};
      }
    });
    const error = await expectCode(() => createApp({ plugins: [eager] }), "E_EMIT_DURING_WIRING");
    expect(error.plugin).toBe("eager");
  });

  it("throws E_EMIT_DURING_WIRING inside the hooks factory body", async () => {
    const eager = framework.definePlugin("eager", {
      hooks: ctx => {
        ctx.emit("page:render", { path: "/" });
        return {};
      }
    });
    await expect(() => createApp({ plugins: [eager] })).toFailWith("E_EMIT_DURING_WIRING");
  });

  it("allows emits from API methods called during onInit", async () => {
    const seen: string[] = [];
    const emitter = framework.definePlugin("emitter", {
      api: ctx => ({ render: (path: string) => ctx.emit("page:render", { path }) }),
      hooks: () => ({
        "page:render": ({ path }) => {
          seen.push(path);
        }
      }),
      onInit: ctx => ctx.emit("page:render", { path: "/init" })
    });
    const app = await createApp({ plugins: [emitter] });
    app.emitter.render("/later");
    await app.settled();
    expect(seen).toEqual(["/init", "/later"]);
  });
});

describe("hooks", () => {
  it("run after every API exists, so eager get() in the factory works (Q1)", async () => {
    const source = framework.definePlugin("source", { api: () => ({ value: () => 42 }) });
    let eager: number | undefined;
    const reader = framework.definePlugin("reader", {
      depends: [source],
      hooks: ctx => {
        eager = ctx.get(source).value();
        return {};
      }
    });
    await createApp({ plugins: [source, reader] });
    expect(eager).toBe(42);
  });

  it("can hook direct dependencies' events, but not transitive ones", async () => {
    const a = framework.definePlugin("a", { events: { "a:x": event() } });
    const b = framework.definePlugin("b", { depends: [a] });
    const c = framework.definePlugin("c", {
      depends: [b],
      hooks: (() => ({ "a:x": () => {} })) as never
    });
    const error = await expectCode(() => createApp({ plugins: [a, b, c] }), "E_UNKNOWN_HOOK");
    expect(error.message).toContain('Plugin "c" hooks "a:x"');
  });

  it("skips events of optional dependencies that are absent", async () => {
    const optional = framework.definePlugin("optional", { events: { "optional:x": event() } });
    const user = framework.definePlugin("user", {
      optionalDepends: [optional],
      hooks: () => ({ "optional:x": () => {} })
    });
    const app = await createApp({ plugins: [user] });
    expect(app.has("optional")).toBe(false);
  });

  it("rejects hook maps that aren't objects of functions", async () => {
    const notObject = framework.definePlugin("notObject", { hooks: (() => 1) as never });
    await expect(() => createApp({ plugins: [notObject] })).toFailWith("E_INVALID_SPEC");
    const notFunction = framework.definePlugin("notFunction", {
      hooks: (() => ({ "page:render": 1 })) as never
    });
    await expect(() => createApp({ plugins: [notFunction] })).toFailWith("E_INVALID_SPEC");
  });

  it("detaches a plugin before its onStop, so it gets no further events (B9)", async () => {
    const seen: string[] = [];
    const listener = (name: string) =>
      framework.definePlugin(name, {
        hooks: () => ({
          "page:render": ({ path }) => {
            seen.push(`${name} ${path}`);
          }
        })
      });
    let emitLater: ((path: string) => void) | undefined;
    const middle = framework.definePlugin("middle", {
      hooks: () => ({
        "page:render": ({ path }) => {
          seen.push(`middle ${path}`);
        }
      }),
      onStart: ctx => {
        emitLater = path => ctx.emit("page:render", { path });
      },
      onStop: async () => {
        // "last" already stopped (reverse order); "first" is still alive.
        emitLater?.("/while-middle-stops");
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    });
    const app = await createApp({ plugins: [listener("first"), middle, listener("last")] });
    await app.start();
    await app.stop();
    expect(seen).toEqual(["first /while-middle-stops"]);
  });

  it("delivers events emitted just before stop() to everyone, then stops", async () => {
    const seen: string[] = [];
    const listener = framework.definePlugin("listener", {
      hooks: () => ({
        "page:render": ({ path }) => {
          seen.push(path);
        }
      })
    });
    const app = await createApp({ plugins: [listener] });
    await app.start();
    app.emit("page:render", { path: "/before-stop" });
    await app.stop();
    expect(seen).toEqual(["/before-stop"]);
  });
});

describe("error reporting (B6)", () => {
  const thrower = framework.definePlugin("thrower", {
    hooks: () => ({
      "page:render": () => {
        throw new Error("handler broke");
      }
    })
  });
  const after = framework.definePlugin("after", {
    state: () => ({ ran: false }),
    api: ctx => ({ ran: () => ctx.state.ran }),
    hooks: ctx => ({
      "page:render": () => {
        ctx.state.ran = true;
      }
    })
  });

  it("reports handler failures as E_HANDLER_FAILED to framework then consumer onError", async () => {
    const calls: string[] = [];
    let reported: BasaltError | undefined;
    const composed = framework.compose({
      plugins: [thrower, after],
      onError: error => {
        calls.push(`framework ${error.code}`);
      }
    });
    const app = await composed.createApp({
      onError: (error, ctx) => {
        reported = error;
        calls.push(`app ${error.code} ${typeof ctx.after.ran}`);
      }
    });
    app.emit("page:render", { path: "/" });
    await app.settled();
    expect(calls).toEqual(["framework E_HANDLER_FAILED", "app E_HANDLER_FAILED function"]);
    expect(reported?.plugin).toBe("thrower");
    expect((reported?.cause as Error).message).toBe("handler broke");
    expect(app.after.ran()).toBe(true);
  });

  it("falls back to console.error when no one passed onError (Q8)", async () => {
    const consoleError = spyConsoleError();
    const app = await createApp({ plugins: [thrower] });
    app.emit("page:render", { path: "/" });
    await app.settled();
    expect(consoleError).toHaveBeenCalledOnce();
    expect((consoleError.mock.calls[0]?.[0] as BasaltError).code).toBe("E_HANDLER_FAILED");
  });

  it("sends errors thrown or rejected by onError to the console", async () => {
    const consoleError = spyConsoleError();
    const app = await createApp({
      plugins: [thrower],
      onError: () => {
        throw new Error("onError broke");
      }
    });
    app.emit("page:render", { path: "/" });
    await app.settled();
    expect((consoleError.mock.calls[0]?.[0] as Error).message).toBe("onError broke");

    const rejecting = await createApp({
      plugins: [thrower],
      onError: (async () => {
        throw new Error("async onError broke");
      }) as never
    });
    rejecting.emit("page:render", { path: "/" });
    await rejecting.settled();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((consoleError.mock.calls[1]?.[0] as Error).message).toBe("async onError broke");
  });

  it("drops and reports emits after stop (E_EMIT_AFTER_STOP)", async () => {
    const codes: string[] = [];
    const app = await createApp({
      onError: error => {
        codes.push(error.code);
      }
    });
    await app.start();
    await app.stop();
    app.emit("page:render", { path: "/" });
    await app.settled();
    expect(codes).toEqual(["E_EMIT_AFTER_STOP"]);
  });
});
