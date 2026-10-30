import { type Callbacks, type ComposePlan, createAppFromPlan } from "./app";
import { assertConfigSpec } from "./config";
import { BasaltError, describeValue } from "./errors";
import { buildCatalog } from "./event";
import { flattenPlugins, validateOverrideKeys, validatePlan } from "./plan";
import { createPluginFactory } from "./plugin";
import { type FrameworkRecord, packs, type ServiceRecord, services } from "./registry";
import type {
  AnyService,
  ConfigInput,
  ConfigOutput,
  ConfigSpec,
  DefinedFramework,
  DefineFrameworkWithConfig,
  EmptyObject,
  EventMap,
  FrameworkOptions,
  PartialOverrides
} from "./types";
import {
  assertFunctions,
  assertKnownKeys,
  assertName,
  assertObject,
  deepFreeze,
  KERNEL_ID
} from "./utilities";

const FRAMEWORK_OPTIONS: ReadonlySet<string> = new Set([
  "config",
  "events",
  "services",
  "serviceConfigs"
]);
const COMPOSE_OPTIONS: ReadonlySet<string> = new Set([
  "plugins",
  "pluginConfigs",
  "onReady",
  "onStart",
  "onStop",
  "onError"
]);
const CALLBACKS = ["onReady", "onStart", "onStop", "onError"] as const;
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Defines a framework (Layer 2, step 1): global config, global events and services.
 * Returns `{ id, definePlugin, pack, compose }`, frozen. Call it with no arguments and
 * an explicit type, `defineFramework<SiteConfig>()(id, options)`, to check the config
 * against a written-out type.
 *
 * @returns A function taking `(id, options)`, with the config type fixed.
 * @example
 * ```ts
 * const site = defineFramework<SiteConfig>()("site", { config: { mode: "development" } });
 * ```
 */
export function defineFramework<C>(): DefineFrameworkWithConfig<C>;
/**
 * Defines a framework (Layer 2, step 1): global config, global events and services.
 * Returns `{ id, definePlugin, pack, compose }`, frozen. Every type is inferred.
 *
 * @param id - kebab-case framework id, used in every error message.
 * @param options - `config` (defaults or a Standard Schema), `events`, `services`, `serviceConfigs`.
 * @returns The framework.
 * @example
 * ```ts
 * const site = defineFramework("site", {
 *   config: { siteName: "Untitled", mode: "development" as Mode },
 *   events: { "page:render": event<{ path: string; html: string }>("A page finished rendering") },
 *   services: [envService, logService]
 * });
 * export const definePlugin = site.definePlugin;
 * ```
 */
export function defineFramework<
  const Id extends string,
  CS extends ConfigSpec | undefined = undefined,
  E extends EventMap = EmptyObject,
  const SV extends readonly AnyService[] = readonly [],
  const SC extends PartialOverrides<SV[number]> = EmptyObject
>(
  id: Id,
  options?: FrameworkOptions<CS, E, SV, SC>
): DefinedFramework<Id, ConfigOutput<CS>, ConfigInput<CS>, E, SV, SC>;
/**
 * Implementation of both `defineFramework` forms.
 *
 * @param rest - Nothing (curried form) or `(id, options)`.
 * @returns The framework, or the curried function.
 * @example
 * ```ts
 * defineFramework("site", {});
 * ```
 */
export function defineFramework(...rest: unknown[]): unknown {
  if (rest.length === 0) {
    return createFramework;
  }
  return createFramework(rest[0], rest[1]);
}

/**
 * Validates the framework options and builds the framework object.
 *
 * @param id - The framework id.
 * @param rawOptions - The options.
 * @returns The frozen framework.
 * @throws {BasaltError} `E_INVALID_NAME`, `E_INVALID_SPEC`, `E_EVENT_NAMESPACE`, and service-list errors.
 * @example
 * ```ts
 * createFramework("site", { config: { siteName: "Untitled" } });
 * ```
 */
function createFramework(id: unknown, rawOptions: unknown): object {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new BasaltError({
      code: "E_INVALID_NAME",
      frameworkId: KERNEL_ID,
      message: `Framework id ${describeValue(id)} is not valid.`,
      hint: 'Use a kebab-case id that starts with a letter, such as "site" or "my-worker".'
    });
  }
  const options = rawOptions ?? {};
  assertObject(id, "The defineFramework options", options, "Pass an object literal.");
  assertKnownKeys(id, "defineFramework", options, FRAMEWORK_OPTIONS);
  assertConfigSpec(
    { frameworkId: id, label: "the global config", overridePath: "config" },
    options.config
  );

  const record: FrameworkRecord = {
    id,
    config: deepFreeze(options.config),
    catalog: buildCatalog(id, options.events),
    services: resolveServices(id, options.services),
    serviceConfigs: deepFreeze({ ...(options.serviceConfigs as object | undefined) })
  };
  validateOverrideKeys(record, [], options.serviceConfigs, "serviceConfigs");

  return Object.freeze({
    id,
    _phantom: Object.freeze({}),
    definePlugin: createPluginFactory(record),
    pack: createPack.bind(undefined, record),
    compose: compose.bind(undefined, record)
  });
}

/**
 * Validates the framework's service list: service definitions, unique names, and
 * each service's dependencies listed earlier (by identity).
 *
 * @param frameworkId - Framework id for error messages.
 * @param list - The `services` option.
 * @returns The service records, in order.
 * @throws {BasaltError} `E_INVALID_SPEC`, `E_DUPLICATE_NAME`, `E_DEPENDENCY_MISSING`, `E_DEPENDENCY_ORDER`.
 * @example
 * ```ts
 * resolveServices("site", [envService, logService]);
 * ```
 */
function resolveServices(frameworkId: string, list: unknown): readonly ServiceRecord[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId,
      message: `"services" must be an array of services, got ${describeValue(list)}.`,
      hint: "Write services: [envService, logService]."
    });
  }
  const records: ServiceRecord[] = [];
  for (const item of list as unknown[]) {
    const record = typeof item === "object" && item !== null ? services.get(item) : undefined;
    if (record === undefined) {
      throw new BasaltError({
        code: "E_INVALID_SPEC",
        frameworkId,
        message: `${describeValue(item)} in "services" is not a service definition.`,
        hint: "Pass the values defineService returns."
      });
    }
    assertServicePlacement(frameworkId, record, records, list as unknown[]);
    records.push(record);
  }
  return records;
}

/**
 * Checks that a service isn't listed twice and that its dependencies come earlier.
 *
 * @param frameworkId - Framework id for error messages.
 * @param record - The service being placed.
 * @param earlier - The services before it.
 * @param list - The whole `services` option, to tell "later" from "missing".
 * @throws {BasaltError} `E_DUPLICATE_NAME`, `E_DEPENDENCY_ORDER`, `E_DEPENDENCY_MISSING`.
 * @example
 * ```ts
 * assertServicePlacement("site", logRecord, [envRecord], [envService, logService]);
 * ```
 */
function assertServicePlacement(
  frameworkId: string,
  record: ServiceRecord,
  earlier: readonly ServiceRecord[],
  list: readonly unknown[]
): void {
  if (earlier.some(existing => existing.name === record.name)) {
    throw new BasaltError({
      code: "E_DUPLICATE_NAME",
      frameworkId,
      plugin: record.name,
      message: `Service "${record.name}" appears twice in "services".`,
      hint: "List each service once."
    });
  }
  const dependency = record.depends.find(candidate => !earlier.includes(candidate));
  if (dependency === undefined) return;
  const later = list.includes(dependency.definition);
  throw new BasaltError({
    code: later ? "E_DEPENDENCY_ORDER" : "E_DEPENDENCY_MISSING",
    frameworkId,
    plugin: record.name,
    message: later
      ? `Service "${record.name}" depends on "${dependency.name}", but "${dependency.name}" appears after it.`
      : `Service "${record.name}" depends on "${dependency.name}", which is not in "services".`,
    hint: `List "${dependency.name}" before "${record.name}" in "services".`
  });
}

/**
 * `framework.pack(name, plugins)`: a flat, config-free, named group of plugins (O8, O16).
 *
 * @param framework - The framework.
 * @param name - The pack name.
 * @param list - The plugins.
 * @returns The frozen pack.
 * @throws {BasaltError} `E_INVALID_NAME`, `E_INVALID_SPEC`, `E_FOREIGN_PLUGIN`.
 * @example
 * ```ts
 * createPack(frameworkRecord, "roomStage", [peerPlugin, stagePlugin]);
 * ```
 */
function createPack(framework: FrameworkRecord, name: unknown, list: unknown): object {
  assertName(framework.id, "Pack", name);
  if (Array.isArray(list) && list.some(item => packs.has(item as object))) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: framework.id,
      message: `Pack "${name}" contains another pack. Packs are flat.`,
      hint: "List the plugins directly, or pass both packs to createApp side by side."
    });
  }
  const entries = flattenPlugins(framework, list, "framework");
  const definitions = entries.map(entry => entry.record.definition);
  const pack = Object.freeze({
    kind: "pack" as const,
    framework: framework.id,
    name,
    plugins: Object.freeze(definitions)
  });
  packs.set(pack, { name, framework, plugins: entries.map(entry => entry.record) });
  return pack;
}

/**
 * `framework.compose(options)` (Layer 2, step 2): validates the default plugins now
 * (fixes Q13) and returns `{ createApp }`.
 *
 * @param framework - The framework.
 * @param rawOptions - `plugins`, `pluginConfigs` and callbacks.
 * @returns `{ createApp }`, frozen.
 * @throws {BasaltError} `E_INVALID_SPEC`, plugin-list and override errors.
 * @example
 * ```ts
 * compose(frameworkRecord, { plugins: [routerPlugin] });
 * ```
 */
function compose(framework: FrameworkRecord, rawOptions: unknown): object {
  assertObject(framework.id, "The compose options", rawOptions, "Pass an object literal.");
  assertKnownKeys(framework.id, "compose", rawOptions, COMPOSE_OPTIONS);
  assertFunctions(framework.id, "compose", rawOptions, CALLBACKS);
  const entries = flattenPlugins(framework, rawOptions.plugins, "framework");
  validatePlan(framework, entries);
  validateOverrideKeys(framework, entries, rawOptions.pluginConfigs, "pluginConfigs");

  const plan: ComposePlan = Object.freeze({
    framework,
    entries: Object.freeze(entries),
    pluginConfigs: deepFreeze(rawOptions.pluginConfigs as Record<string, unknown> | undefined),
    callbacks: Object.freeze({ ...rawOptions }) as Callbacks
  });
  return Object.freeze({ createApp: createAppFromPlan.bind(undefined, plan) });
}
