// =============================================================================
// The kernel: createApp, the event bus, contexts and the lifecycle.
// Algorithm: docs/basalt-design.md §32. Lifecycle: §27.
// =============================================================================

import { type ConfigTarget, resolveConfig } from "./config";
import { BasaltError, describeValue } from "./errors";
import { flattenPlugins, type PlanEntry, validateOverrideKeys, validatePlan } from "./plan";
import {
  type ContextFunction,
  type FrameworkRecord,
  type PluginRecord,
  plugins,
  type ServiceRecord,
  services
} from "./registry";
import type { AppStatus } from "./types";
import {
  assertFunctions,
  assertKnownKeys,
  assertObject,
  isPlainObject,
  isThenable,
  reportToConsole
} from "./utilities";

/**
 * An error callback, as passed to `compose` or `createApp`.
 *
 * @example
 * ```ts
 * const onError: ErrorFunction = (error, context) => {};
 * ```
 */
type ErrorFunction = (error: BasaltError, context: Record<string, unknown>) => unknown;

/**
 * The lifecycle callbacks of one layer (framework or consumer).
 *
 * @example
 * ```ts
 * const callbacks: Callbacks = { onReady: context => {} };
 * ```
 */
export interface Callbacks {
  /** After init. */
  readonly onReady?: ContextFunction | undefined;
  /** During start. */
  readonly onStart?: ContextFunction | undefined;
  /** During stop. */
  readonly onStop?: ContextFunction | undefined;
  /** For reported errors. */
  readonly onError?: ErrorFunction | undefined;
}

/**
 * Everything `compose` fixed: the framework, its default plugins and its overrides.
 *
 * @example
 * ```ts
 * const plan: ComposePlan = { framework, entries, pluginConfigs: undefined, callbacks: {} };
 * ```
 */
export interface ComposePlan {
  /** The framework. */
  readonly framework: FrameworkRecord;
  /** Default plugins, flattened and validated. */
  readonly entries: readonly PlanEntry[];
  /** Framework-level overrides. */
  readonly pluginConfigs: Readonly<Record<string, unknown>> | undefined;
  /** Framework callbacks. */
  readonly callbacks: Callbacks;
}

/**
 * A plugin inside a live app.
 *
 * @example
 * ```ts
 * kernel.plugins[0].api;
 * ```
 */
interface PluginRuntime {
  readonly record: PluginRecord;
  config: object;
  state: unknown;
  api: unknown;
  built: boolean;
  detached: boolean;
  context: Record<string, unknown>;
}

/**
 * A service inside a live app.
 *
 * @example
 * ```ts
 * kernel.services[0].api;
 * ```
 */
interface ServiceRuntime {
  readonly record: ServiceRecord;
  context: Record<string, unknown>;
  api: unknown;
}

/**
 * One registered hook handler.
 *
 * @example
 * ```ts
 * const handler: Handler = { plugin, run: payload => {} };
 * ```
 */
interface Handler {
  readonly plugin: PluginRuntime;
  readonly run: (payload: unknown) => unknown;
}

/**
 * A lifecycle step: a hook, the context it gets, and a name for error messages.
 * A plugin given in `detach` stops receiving events before the hook runs (B9).
 *
 * @example
 * ```ts
 * const target: Target = { name: "router", hook: record.onStart, context };
 * ```
 */
interface Target {
  readonly name: string;
  readonly hook: ContextFunction | undefined;
  readonly context: Record<string, unknown>;
  readonly detach?: PluginRuntime;
}

/**
 * The mutable heart of one app instance.
 *
 * @example
 * ```ts
 * kernel.status; // "ready"
 * ```
 */
interface Kernel {
  readonly frameworkId: string;
  readonly framework: Callbacks;
  readonly consumer: Callbacks;
  readonly plugins: readonly PluginRuntime[];
  readonly byRecord: ReadonlyMap<PluginRecord, PluginRuntime>;
  readonly services: readonly ServiceRuntime[];
  readonly serviceApis: Record<string, unknown>;
  readonly names: ReadonlySet<string>;
  readonly catalog: ReadonlySet<string>;
  readonly handlers: Map<string, Handler[]>;
  readonly inFlight: Set<Promise<void>>;
  status: AppStatus;
  phase: "wiring" | "live";
  global: object;
  appContext: Record<string, unknown>;
  starting: Promise<void> | undefined;
  stopping: Promise<void> | undefined;
}

const APP_OPTIONS: ReadonlySet<string> = new Set([
  "plugins",
  "config",
  "pluginConfigs",
  "onReady",
  "onStart",
  "onStop",
  "onError"
]);

/**
 * Creates an app from a compose plan (§32). Resolves once every config is validated
 * and every `onInit` and `onReady` has finished.
 *
 * @param plan - The compose plan.
 * @param rawOptions - The consumer's `createApp` options.
 * @returns The frozen app.
 * @throws {BasaltError} Any validation, config or init error.
 * @example
 * ```ts
 * const app = await createAppFromPlan(plan, { plugins: [blogPlugin] });
 * ```
 */
export async function createAppFromPlan(plan: ComposePlan, rawOptions: unknown): Promise<object> {
  const framework = plan.framework;
  const options = readAppOptions(framework.id, rawOptions);
  const entries = [...plan.entries, ...flattenPlugins(framework, options.plugins, "app")];
  validatePlan(framework, entries);
  validateOverrideKeys(framework, entries, options.pluginConfigs, "pluginConfigs");
  const appOverrides = options.pluginConfigs as Readonly<Record<string, unknown>> | undefined;

  const kernel = createKernel(plan, options as Callbacks, entries);
  kernel.global = await resolveConfig(
    { frameworkId: framework.id, label: "the global config", overridePath: "config" },
    framework.config,
    [options.config]
  );

  // Services: config → state → api → onInit, in order.
  for (const service of kernel.services) {
    const name = service.record.name;
    const config = await resolveConfig(
      target(framework.id, "service", name),
      service.record.config,
      [framework.serviceConfigs[name], plan.pluginConfigs?.[name], appOverrides?.[name]]
    );
    await initService(kernel, service, config);
  }

  // Plugins: config → state. Services are fully initialised by now.
  for (const plugin of kernel.plugins) {
    const name = plugin.record.name;
    plugin.config = await resolveConfig(
      target(framework.id, "plugin", name),
      plugin.record.config,
      [plan.pluginConfigs?.[name], appOverrides?.[name]]
    );
    plugin.state =
      plugin.record.state?.({
        ...kernel.serviceApis,
        global: kernel.global,
        config: plugin.config
      }) ?? {};
    plugin.context = createPluginContext(kernel, plugin);
  }

  // Wiring: every API is built before any hook factory runs (fixes Q1). Emitting throws.
  for (const plugin of kernel.plugins) {
    plugin.api = plugin.record.api?.(plugin.context) ?? Object.freeze({});
    plugin.built = true;
  }
  kernel.appContext = createAppContext(kernel);
  for (const plugin of kernel.plugins) registerHooks(kernel, plugin);
  kernel.phase = "live";

  for (const plugin of kernel.plugins) await plugin.record.onInit?.(plugin.context);
  await kernel.framework.onReady?.(kernel.appContext);
  await kernel.consumer.onReady?.(kernel.appContext);
  kernel.status = "ready";
  return createAppObject(kernel);
}

/**
 * Validates the shape of the `createApp` options.
 *
 * @param frameworkId - Framework id for error messages.
 * @param rawOptions - The options, possibly undefined.
 * @returns The options as a record.
 * @throws {BasaltError} `E_INVALID_SPEC`.
 * @example
 * ```ts
 * readAppOptions("site", { plugins: [] });
 * ```
 */
function readAppOptions(frameworkId: string, rawOptions: unknown): Record<string, unknown> {
  const options = rawOptions ?? {};
  assertObject(
    frameworkId,
    "The createApp options",
    options,
    "Pass an object literal, or nothing."
  );
  assertKnownKeys(frameworkId, "createApp", options, APP_OPTIONS);
  assertFunctions(frameworkId, "createApp", options, ["onReady", "onStart", "onStop", "onError"]);
  return options;
}

/**
 * Builds the config target for a plugin or service.
 *
 * @param frameworkId - Framework id.
 * @param kind - `"plugin"` or `"service"`.
 * @param name - The name.
 * @returns The target.
 * @example
 * ```ts
 * target("site", "plugin", "router");
 * ```
 */
function target(frameworkId: string, kind: "plugin" | "service", name: string): ConfigTarget {
  return {
    frameworkId,
    label: `${kind} "${name}"`,
    plugin: name,
    overridePath: `pluginConfigs.${name}`
  };
}

/**
 * Creates the kernel state for a validated plugin list.
 *
 * @param plan - The compose plan.
 * @param consumer - The consumer callbacks.
 * @param entries - The validated, flattened plugin list.
 * @returns A fresh kernel.
 * @example
 * ```ts
 * const kernel = createKernel(plan, {}, entries);
 * ```
 */
function createKernel(
  plan: ComposePlan,
  consumer: Callbacks,
  entries: readonly PlanEntry[]
): Kernel {
  const pluginRuntimes = entries.map(
    ({ record }): PluginRuntime => ({
      record,
      config: {},
      state: undefined,
      api: undefined,
      built: false,
      detached: false,
      context: {}
    })
  );
  const serviceRuntimes = plan.framework.services.map(
    (record): ServiceRuntime => ({ record, context: {}, api: undefined })
  );
  const catalog = new Set(plan.framework.catalog.map(entry => entry.name));
  for (const { record } of entries) for (const entry of record.catalog) catalog.add(entry.name);
  return {
    frameworkId: plan.framework.id,
    framework: plan.callbacks,
    consumer,
    plugins: pluginRuntimes,
    byRecord: new Map(pluginRuntimes.map(runtime => [runtime.record, runtime])),
    services: serviceRuntimes,
    serviceApis: {},
    names: new Set([
      ...serviceRuntimes.map(runtime => runtime.record.name),
      ...pluginRuntimes.map(runtime => runtime.record.name)
    ]),
    catalog,
    handlers: new Map(),
    inFlight: new Set(),
    status: "ready",
    phase: "wiring",
    global: {},
    appContext: {},
    starting: undefined,
    stopping: undefined
  };
}

/**
 * Builds one service's state, API and context, then awaits its `onInit`.
 *
 * @param kernel - The kernel.
 * @param service - The service runtime.
 * @param config - Its resolved config.
 * @returns Resolves after `onInit`.
 * @example
 * ```ts
 * await initService(kernel, service, { level: "info" });
 * ```
 */
async function initService(kernel: Kernel, service: ServiceRuntime, config: object): Promise<void> {
  const dependencies: Record<string, unknown> = {};
  for (const dependency of service.record.depends) {
    dependencies[dependency.name] = kernel.serviceApis[dependency.name];
  }
  const base = { ...dependencies, global: kernel.global, config };
  const state = service.record.state?.(base) ?? {};
  service.context = Object.freeze({ ...base, state });
  service.api = service.record.api?.(service.context) ?? Object.freeze({});
  kernel.serviceApis[service.record.name] = service.api;
  await service.record.onInit?.(service.context);
}

/**
 * Builds a plugin's context: config, state, services, `emit`, and `get`/`find`/`has`
 * restricted to declared dependencies (§24).
 *
 * @param kernel - The kernel.
 * @param plugin - The plugin runtime (config and state already set).
 * @returns The frozen context.
 * @example
 * ```ts
 * plugin.context = createPluginContext(kernel, plugin);
 * ```
 */
function createPluginContext(kernel: Kernel, plugin: PluginRuntime): Record<string, unknown> {
  return Object.freeze({
    ...kernel.serviceApis,
    global: kernel.global,
    config: plugin.config,
    state: plugin.state,
    emit: createEmit(kernel, plugin.record.name),
    get: createDependencyLookup(kernel, plugin.record, "depends"),
    find: createDependencyLookup(kernel, plugin.record, "optionalDepends"),
    has: hasMember.bind(undefined, kernel)
  });
}

/**
 * Builds `ctx.get` (for `depends`) or `ctx.find` (for `optionalDepends`). Both only
 * reach plugins declared in that field (O3); `find` returns `undefined` for absent ones.
 *
 * @param kernel - The kernel.
 * @param owner - The plugin the context belongs to.
 * @param field - `"depends"` for `get`, `"optionalDepends"` for `find`.
 * @returns The lookup function.
 * @example
 * ```ts
 * const get = createDependencyLookup(kernel, seo, "depends");
 * get(routerPlugin).current();
 * ```
 */
function createDependencyLookup(
  kernel: Kernel,
  owner: PluginRecord,
  field: "depends" | "optionalDepends"
): (definition: unknown) => unknown {
  return definition => {
    const record = lookupPlugin(definition);
    if (record === undefined || !owner[field].includes(record)) {
      const label = record === undefined ? describeValue(definition) : `"${record.name}"`;
      const method = field === "depends" ? "get" : "find";
      throw new BasaltError({
        code: "E_UNDECLARED_DEPENDENCY",
        frameworkId: kernel.frameworkId,
        plugin: owner.name,
        message: `Plugin "${owner.name}" called ctx.${method}(${label}), but ${label} is not in its ${field}.`,
        hint: `Add it to "${field}" in the spec of "${owner.name}".`
      });
    }
    const runtime = kernel.byRecord.get(record);
    if (runtime === undefined) return;
    if (runtime.built) return runtime.api;
    throw new BasaltError({
      code: "E_NOT_READY",
      frameworkId: kernel.frameworkId,
      plugin: owner.name,
      message: `Plugin "${owner.name}" asked for the API of "${record.name}" before it was built.`,
      hint: "Call ctx.get() lazily, inside an API method or handler, not in the api() factory body."
    });
  };
}

/**
 * Looks up a plugin record by definition.
 *
 * @param definition - Anything.
 * @returns The record, or undefined.
 * @example
 * ```ts
 * lookupPlugin(routerPlugin);
 * ```
 */
function lookupPlugin(definition: unknown): PluginRecord | undefined {
  return typeof definition === "object" && definition !== null
    ? plugins.get(definition)
    : undefined;
}

/**
 * `has()`: whether a plugin or service (definition or name) is part of the app.
 *
 * @param kernel - The kernel.
 * @param definition - A definition or a name.
 * @returns `true` if present.
 * @example
 * ```ts
 * hasMember(kernel, "router");
 * ```
 */
function hasMember(kernel: Kernel, definition: unknown): boolean {
  if (typeof definition === "string") return kernel.names.has(definition);
  const plugin = lookupPlugin(definition);
  if (plugin !== undefined) return kernel.byRecord.has(plugin);
  const service =
    typeof definition === "object" && definition !== null ? services.get(definition) : undefined;
  return service !== undefined && kernel.services.some(runtime => runtime.record === service);
}

/**
 * Calls a plugin's `hooks` factory and registers its handlers. Every key must be a
 * visible event; events of absent optional dependencies are skipped.
 *
 * @param kernel - The kernel.
 * @param plugin - The plugin.
 * @throws {BasaltError} `E_INVALID_SPEC` or `E_UNKNOWN_HOOK`.
 * @example
 * ```ts
 * registerHooks(kernel, plugin);
 * ```
 */
function registerHooks(kernel: Kernel, plugin: PluginRuntime): void {
  const { record } = plugin;
  if (record.hooks === undefined) return;
  const map = record.hooks(plugin.context);
  if (!isPlainObject(map)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: kernel.frameworkId,
      plugin: record.name,
      message: `The hooks factory of plugin "${record.name}" returned ${describeValue(map)}, not an object.`,
      hint: 'Write hooks: ctx => ({ "router:navigate": payload => { … } }).'
    });
  }
  const visible = visibleEvents(record);
  for (const [name, handler] of Object.entries(map)) {
    if (typeof handler !== "function") {
      throw new BasaltError({
        code: "E_INVALID_SPEC",
        frameworkId: kernel.frameworkId,
        plugin: record.name,
        message: `Plugin "${record.name}": the hook for "${name}" is not a function.`,
        hint: "Each hook is a function that receives the payload."
      });
    }
    if (!visible.has(name)) {
      throw new BasaltError({
        code: "E_UNKNOWN_HOOK",
        frameworkId: kernel.frameworkId,
        plugin: record.name,
        message: `Plugin "${record.name}" hooks "${name}", which is not visible to it.`,
        hint: "Hooks can name framework events, the plugin's own events, and events of plugins in its depends or optionalDepends."
      });
    }
    if (!kernel.catalog.has(name)) continue;
    const list = kernel.handlers.get(name) ?? [];
    list.push({ plugin, run: handler as (payload: unknown) => unknown });
    kernel.handlers.set(name, list);
  }
}

/**
 * The events a plugin may hook: framework + own + direct (optional) dependencies.
 *
 * @param record - The plugin.
 * @returns The visible event names.
 * @example
 * ```ts
 * visibleEvents(seoRecord).has("router:navigate");
 * ```
 */
function visibleEvents(record: PluginRecord): ReadonlySet<string> {
  const sources = [record.framework, record, ...record.depends, ...record.optionalDepends];
  return new Set(sources.flatMap(source => source.catalog.map(entry => entry.name)));
}

/**
 * Builds a fire-and-forget `emit` bound to a source. Delivery is queued as a
 * microtask, so no handler runs inside `emit()` (B5), and tracked for `settled()`.
 *
 * @param kernel - The kernel.
 * @param source - The emitting plugin's name, or `"app"`.
 * @returns The `emit` function.
 * @example
 * ```ts
 * const emit = createEmit(kernel, "router");
 * emit("router:navigate", { from: "/", to: "/about" });
 * ```
 */
function createEmit(kernel: Kernel, source: string): (name: unknown, payload?: unknown) => void {
  return (name, payload) => {
    if (kernel.status === "stopped" || kernel.status === "failed") {
      report(
        kernel,
        new BasaltError({
          code: "E_EMIT_AFTER_STOP",
          frameworkId: kernel.frameworkId,
          plugin: source,
          message: `"${source}" emitted ${describeValue(name)} after the app stopped. The event was dropped.`,
          hint: "Clear timers and subscriptions in onStop."
        })
      );
      return;
    }
    if (kernel.phase === "wiring") {
      throw new BasaltError({
        code: "E_EMIT_DURING_WIRING",
        frameworkId: kernel.frameworkId,
        plugin: source,
        message: `"${source}" emitted ${describeValue(name)} while APIs were still being built.`,
        hint: "Emit from API methods, hooks or lifecycle methods, not from the api() or hooks() factory body."
      });
    }
    if (typeof name !== "string" || !kernel.catalog.has(name)) {
      throw new BasaltError({
        code: "E_UNKNOWN_EVENT",
        frameworkId: kernel.frameworkId,
        plugin: source,
        message: `"${source}" emitted ${describeValue(name)}, which no one in this app declares.`,
        hint: "Declare the event with event() in the framework or the emitting plugin."
      });
    }
    const delivery = Promise.resolve().then(() => deliver(kernel, name, payload));
    kernel.inFlight.add(delivery);
    delivery.finally(() => kernel.inFlight.delete(delivery));
  };
}

/**
 * Runs every handler for an event, in plugin order, awaiting each. A failing handler
 * is reported and delivery moves on.
 *
 * @param kernel - The kernel.
 * @param name - The event name.
 * @param payload - The payload.
 * @returns Resolves when every handler has finished.
 * @example
 * ```ts
 * await deliver(kernel, "router:navigate", { from: "/", to: "/about" });
 * ```
 */
async function deliver(kernel: Kernel, name: string, payload: unknown): Promise<void> {
  for (const handler of kernel.handlers.get(name) ?? []) {
    if (handler.plugin.detached) continue;
    try {
      await handler.run(payload);
    } catch (error) {
      const plugin = handler.plugin.record.name;
      report(
        kernel,
        new BasaltError({
          code: "E_HANDLER_FAILED",
          frameworkId: kernel.frameworkId,
          plugin,
          message: `Plugin "${plugin}" failed while handling "${name}".`,
          hint: "See the cause. Other handlers still ran.",
          cause: error
        })
      );
    }
  }
}

/**
 * Reports an error to the framework and consumer `onError`, or to the console when
 * neither exists. Errors thrown by `onError` itself go to the console (B6).
 *
 * @param kernel - The kernel.
 * @param error - The error.
 * @example
 * ```ts
 * report(kernel, new BasaltError({ … }));
 * ```
 */
function report(kernel: Kernel, error: BasaltError): void {
  const callbacks = [kernel.framework.onError, kernel.consumer.onError].filter(
    (callback): callback is ErrorFunction => callback !== undefined
  );
  if (callbacks.length === 0) {
    reportToConsole(error);
    return;
  }
  for (const callback of callbacks) {
    try {
      const result = callback(error, kernel.appContext);
      if (isThenable(result)) result.then(undefined, reportToConsole);
    } catch (callbackError) {
      reportToConsole(callbackError);
    }
  }
}

/**
 * Builds the context framework and consumer callbacks receive: every API, global
 * config, an `emit` typed with every event, and unrestricted `get`/`find`/`has`.
 *
 * @param kernel - The kernel, with every API built.
 * @returns The frozen app context.
 * @example
 * ```ts
 * kernel.appContext = createAppContext(kernel);
 * ```
 */
function createAppContext(kernel: Kernel): Record<string, unknown> {
  const apis: Record<string, unknown> = { ...kernel.serviceApis };
  for (const plugin of kernel.plugins) apis[plugin.record.name] = plugin.api;
  return Object.freeze({
    ...apis,
    global: kernel.global,
    emit: createEmit(kernel, "app"),
    get: appGet.bind(undefined, kernel),
    find: appFind.bind(undefined, kernel),
    has: hasMember.bind(undefined, kernel)
  });
}

/**
 * `app.get(plugin)`: any plugin in the app; throws for absent ones.
 *
 * @param kernel - The kernel.
 * @param definition - A plugin definition.
 * @returns Its API.
 * @throws {BasaltError} `E_DEPENDENCY_MISSING`.
 * @example
 * ```ts
 * appGet(kernel, routerPlugin).current();
 * ```
 */
function appGet(kernel: Kernel, definition: unknown): unknown {
  const record = lookupPlugin(definition);
  const runtime = record && kernel.byRecord.get(record);
  if (runtime !== undefined) return runtime.api;
  throw new BasaltError({
    code: "E_DEPENDENCY_MISSING",
    frameworkId: kernel.frameworkId,
    message: `get(${describeValue(record?.name ?? definition)}) failed: that plugin is not part of this app.`,
    hint: "Pass it to createApp({ plugins }), or use find() for plugins that may be absent."
  });
}

/**
 * `app.find(plugin)`: a plugin's API, or `undefined` if it isn't in the app.
 *
 * @param kernel - The kernel.
 * @param definition - A plugin definition.
 * @returns Its API, or `undefined`.
 * @example
 * ```ts
 * appFind(kernel, seoPlugin)?.title();
 * ```
 */
function appFind(kernel: Kernel, definition: unknown): unknown {
  const record = lookupPlugin(definition);
  return record && kernel.byRecord.get(record)?.api;
}

/**
 * Builds the frozen app object: the app context plus `status`, `start`, `stop` and
 * `settled`.
 *
 * @param kernel - The kernel.
 * @returns The app.
 * @example
 * ```ts
 * return createAppObject(kernel);
 * ```
 */
function createAppObject(kernel: Kernel): object {
  const app = {
    ...kernel.appContext,
    start: start.bind(undefined, kernel),
    stop: stop.bind(undefined, kernel),
    settled: settled.bind(undefined, kernel)
  };
  Object.defineProperty(app, "status", {
    enumerable: true,
    get: readStatus.bind(undefined, kernel)
  });
  return Object.freeze(app);
}

/**
 * The `app.status` getter.
 *
 * @param kernel - The kernel.
 * @returns The current status.
 * @example
 * ```ts
 * readStatus(kernel); // "ready"
 * ```
 */
function readStatus(kernel: Kernel): AppStatus {
  return kernel.status;
}

/**
 * Resolves once nothing is in flight, including deliveries queued by handlers.
 *
 * @param kernel - The kernel.
 * @returns Resolves when the bus is idle.
 * @example
 * ```ts
 * await settled(kernel);
 * ```
 */
async function settled(kernel: Kernel): Promise<void> {
  while (kernel.inFlight.size > 0) await Promise.allSettled(kernel.inFlight);
}

/**
 * `app.start()`: `ready` → `starting` → `running` (§27.3). A second call while
 * starting returns the same promise.
 *
 * @param kernel - The kernel.
 * @returns Resolves when running.
 * @example
 * ```ts
 * await start(kernel);
 * ```
 */
function start(kernel: Kernel): Promise<void> {
  if (kernel.status === "starting" && kernel.starting !== undefined) return kernel.starting;
  if (kernel.status !== "ready") {
    return Promise.reject(
      new BasaltError({
        code: "E_INVALID_STATE",
        frameworkId: kernel.frameworkId,
        message: `start() was called while the app is "${kernel.status}".`,
        hint: "An app starts once. Create a new app to start again."
      })
    );
  }
  kernel.status = "starting";
  kernel.starting = runTargets(kernel, startTargets(kernel), "E_START_FAILED").then(() => {
    kernel.status = "running";
  });
  return kernel.starting;
}

/**
 * Start order: services, plugins, framework `onStart`, consumer `onStart`.
 *
 * @param kernel - The kernel.
 * @returns The start targets, in order.
 * @example
 * ```ts
 * startTargets(kernel).map(target => target.name);
 * ```
 */
function startTargets(kernel: Kernel): Target[] {
  return [
    ...kernel.services.map(({ record, context }) => ({
      name: record.name,
      hook: record.onStart,
      context
    })),
    ...kernel.plugins.map(({ record, context }) => ({
      name: record.name,
      hook: record.onStart,
      context
    })),
    { name: "compose.onStart", hook: kernel.framework.onStart, context: kernel.appContext },
    { name: "createApp.onStart", hook: kernel.consumer.onStart, context: kernel.appContext }
  ];
}

/**
 * `app.stop()`: idempotent and never throws `E_INVALID_STATE` (§27.4).
 *
 * @param kernel - The kernel.
 * @returns Resolves when stopped.
 * @example
 * ```ts
 * await stop(kernel);
 * ```
 */
function stop(kernel: Kernel): Promise<void> {
  switch (kernel.status) {
    case "ready": {
      kernel.status = "stopped";
      return Promise.resolve();
    }
    case "starting": {
      return (kernel.starting ?? Promise.resolve()).then(ignore, ignore).then(() => stop(kernel));
    }
    case "running": {
      kernel.status = "stopping";
      kernel.stopping = settled(kernel)
        .then(() => runTargets(kernel, stopTargets(kernel), "E_STOP_FAILED"))
        .finally(() => {
          kernel.status = "stopped";
        });
      return kernel.stopping;
    }
    case "stopping": {
      return kernel.stopping ?? Promise.resolve();
    }
    default: {
      return Promise.resolve();
    }
  }
}

/**
 * Ignores a value. Used to wait for a promise without caring how it settles.
 *
 * @example
 * ```ts
 * promise.then(ignore, ignore);
 * ```
 */
function ignore(): void {
  // Intentionally empty.
}

/**
 * Stop order: consumer `onStop`, framework `onStop` (first, while everything is
 * alive; fixes Q6), plugins in reverse (each detached from the bus first, B9),
 * then services in reverse.
 *
 * @param kernel - The kernel.
 * @returns The stop targets, in order.
 * @example
 * ```ts
 * stopTargets(kernel).map(target => target.name);
 * ```
 */
function stopTargets(kernel: Kernel): Target[] {
  return [
    { name: "createApp.onStop", hook: kernel.consumer.onStop, context: kernel.appContext },
    { name: "compose.onStop", hook: kernel.framework.onStop, context: kernel.appContext },
    ...kernel.plugins.toReversed().map(plugin => ({
      name: plugin.record.name,
      hook: plugin.record.onStop,
      context: {
        ...kernel.serviceApis,
        global: kernel.global,
        config: plugin.config,
        state: plugin.state
      },
      detach: plugin
    })),
    ...kernel.services.toReversed().map(({ record, context }) => ({
      name: record.name,
      hook: record.onStop,
      context
    }))
  ];
}

/**
 * Runs lifecycle targets in order. The first failure moves the app to `failed`
 * (start) and rejects with `code`. Rollback and best-effort stop arrive in M2.
 *
 * @param kernel - The kernel.
 * @param targets - The targets.
 * @param code - `E_START_FAILED` or `E_STOP_FAILED`.
 * @returns Resolves when every target has run.
 * @example
 * ```ts
 * await runTargets(kernel, startTargets(kernel), "E_START_FAILED");
 * ```
 */
async function runTargets(
  kernel: Kernel,
  targets: readonly Target[],
  code: "E_START_FAILED" | "E_STOP_FAILED"
): Promise<void> {
  for (const { name, hook, context, detach } of targets) {
    if (detach) detach.detached = true;
    try {
      await hook?.(context);
    } catch (error) {
      if (code === "E_START_FAILED") kernel.status = "failed";
      throw new BasaltError({
        code,
        frameworkId: kernel.frameworkId,
        plugin: name,
        message: `${code === "E_START_FAILED" ? "Start" : "Stop"} failed in "${name}".`,
        hint: "See the cause.",
        cause: error
      });
    }
  }
}
