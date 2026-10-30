// =============================================================================
// Plugin-list validation, shared by compose (framework defaults, Q13) and
// createApp (the merged list).
// =============================================================================

import { BasaltError, describeValue } from "./errors";
import { type FrameworkRecord, type PluginRecord, packs, plugins } from "./registry";
import { isPlainObject } from "./utilities";

/**
 * One plugin in an app's flattened list.
 *
 * @example
 * ```ts
 * const entry: PlanEntry = { record, pack: "roomStage", origin: "app" };
 * ```
 */
export interface PlanEntry {
  /** The plugin. */
  readonly record: PluginRecord;
  /** The pack it came from, if any. */
  readonly pack: string | undefined;
  /** Who added it. */
  readonly origin: "framework" | "app";
}

/**
 * Flattens a `plugins` array (plugins and packs) into entries, checking that every
 * item belongs to this framework.
 *
 * @param framework - The framework.
 * @param list - The `plugins` option.
 * @param origin - Who passed the list.
 * @returns The flattened entries.
 * @throws {BasaltError} `E_INVALID_SPEC` or `E_FOREIGN_PLUGIN`.
 * @example
 * ```ts
 * flattenPlugins(frameworkRecord, [stagePack, gamePlugin], "app");
 * ```
 */
export function flattenPlugins(
  framework: FrameworkRecord,
  list: unknown,
  origin: PlanEntry["origin"]
): PlanEntry[] {
  const where = origin === "framework" ? "compose" : "createApp";
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: framework.id,
      message: `${where}: "plugins" must be an array, got ${describeValue(list)}.`,
      hint: "Write plugins: [routerPlugin, seoPlugin]."
    });
  }
  return (list as unknown[]).flatMap(item => flattenItem(framework, item, origin, where));
}

/**
 * Turns one `plugins` item into entries: a pack becomes its plugins, a plugin stays one.
 *
 * @param framework - The framework.
 * @param item - The item.
 * @param origin - Who passed the list.
 * @param where - `compose` or `createApp`, for error messages.
 * @returns The entries for this item.
 * @throws {BasaltError} `E_INVALID_SPEC` or `E_FOREIGN_PLUGIN`.
 * @example
 * ```ts
 * flattenItem(frameworkRecord, stagePack, "app", "createApp");
 * ```
 */
function flattenItem(
  framework: FrameworkRecord,
  item: unknown,
  origin: PlanEntry["origin"],
  where: string
): PlanEntry[] {
  const key = typeof item === "object" && item !== null ? item : undefined;
  const pack = key && packs.get(key);
  const record = key && plugins.get(key);
  const owner = pack?.framework ?? record?.framework;
  if (owner === undefined) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: framework.id,
      message: `${where}: ${describeValue(item)} in "plugins" is not a plugin definition or pack.`,
      hint: "Pass the values that definePlugin and framework.pack return."
    });
  }
  if (owner !== framework) {
    const label = pack ? `Pack "${pack.name}"` : `Plugin "${record?.name}"`;
    throw new BasaltError({
      code: "E_FOREIGN_PLUGIN",
      frameworkId: framework.id,
      message: `${label} belongs to framework "${owner.id}", not "${framework.id}".`,
      hint: `Use plugins made with the "${framework.id}" framework's definePlugin.`
    });
  }
  if (pack) return pack.plugins.map(packed => ({ record: packed, pack: pack.name, origin }));
  return record ? [{ record, pack: undefined, origin }] : [];
}

/**
 * Validates a flattened plugin list: unique names across services and plugins,
 * dependencies present and earlier (by identity, fixing Q11), and no event declared twice.
 *
 * @param framework - The framework.
 * @param entries - The flattened list.
 * @throws {BasaltError} `E_DUPLICATE_NAME`, `E_DEPENDENCY_MISSING`, `E_DEPENDENCY_ORDER`, `E_EVENT_CONFLICT`.
 * @example
 * ```ts
 * validatePlan(frameworkRecord, entries);
 * ```
 */
export function validatePlan(framework: FrameworkRecord, entries: readonly PlanEntry[]): void {
  const names = assertUniqueNames(framework, entries);
  const positions = new Map(entries.map(({ record }, index) => [record, index]));
  for (const [index, { record }] of entries.entries()) {
    for (const dependency of record.depends) {
      assertDependency(framework.id, record, dependency, positions.get(dependency), index, names);
    }
    for (const dependency of record.optionalDepends) {
      const position = positions.get(dependency);
      if (position === undefined) continue;
      assertDependency(framework.id, record, dependency, position, index, names);
    }
  }
  assertUniqueEvents(framework, entries);
}

/**
 * Checks that plugin names are unique and don't collide with service names.
 *
 * @param framework - The framework.
 * @param entries - The flattened list.
 * @returns Every registered name, mapped to its kind.
 * @throws {BasaltError} `E_DUPLICATE_NAME`.
 * @example
 * ```ts
 * assertUniqueNames(frameworkRecord, entries).has("router");
 * ```
 */
function assertUniqueNames(
  framework: FrameworkRecord,
  entries: readonly PlanEntry[]
): ReadonlyMap<string, "service" | "plugin"> {
  const names = new Map<string, "service" | "plugin">();
  for (const service of framework.services) names.set(service.name, "service");
  for (const { record } of entries) {
    const taken = names.get(record.name);
    if (taken === "service") {
      throw new BasaltError({
        code: "E_DUPLICATE_NAME",
        frameworkId: framework.id,
        plugin: record.name,
        message: `Plugin "${record.name}" has the same name as a service.`,
        hint: "Rename the plugin; service names are taken."
      });
    }
    if (taken === "plugin") {
      throw new BasaltError({
        code: "E_DUPLICATE_NAME",
        frameworkId: framework.id,
        plugin: record.name,
        message: `Plugin "${record.name}" appears twice in the plugin list.`,
        hint: "Remove the duplicate. Framework defaults are already included; don't pass them to createApp."
      });
    }
    names.set(record.name, "plugin");
  }
  return names;
}

/**
 * Checks that no event is declared twice across the framework and its plugins.
 *
 * @param framework - The framework.
 * @param entries - The flattened list.
 * @throws {BasaltError} `E_EVENT_CONFLICT`.
 * @example
 * ```ts
 * assertUniqueEvents(frameworkRecord, entries);
 * ```
 */
function assertUniqueEvents(framework: FrameworkRecord, entries: readonly PlanEntry[]): void {
  const owners = new Map<string, string>();
  for (const entry of framework.catalog) owners.set(entry.name, "the framework");
  for (const { record } of entries) {
    for (const entry of record.catalog) {
      const owner = owners.get(entry.name);
      if (owner !== undefined) {
        throw new BasaltError({
          code: "E_EVENT_CONFLICT",
          frameworkId: framework.id,
          plugin: record.name,
          message: `Event "${entry.name}" is declared by both ${owner} and plugin "${record.name}".`,
          hint: "Declare each event once. Hook the existing declaration instead."
        });
      }
      owners.set(entry.name, `plugin "${record.name}"`);
    }
  }
}

/**
 * Checks one dependency edge.
 *
 * @param frameworkId - Framework id for error messages.
 * @param record - The dependent plugin.
 * @param dependency - The dependency.
 * @param position - The dependency's index in the list, if present.
 * @param index - The dependent's index.
 * @param names - Every registered name.
 * @throws {BasaltError} `E_DEPENDENCY_MISSING` or `E_DEPENDENCY_ORDER`.
 * @example
 * ```ts
 * assertDependency("site", seo, router, 0, 1, names); // ok
 * ```
 */
function assertDependency(
  frameworkId: string,
  record: PluginRecord,
  dependency: PluginRecord,
  position: number | undefined,
  index: number,
  names: ReadonlyMap<string, string>
): void {
  if (position === undefined) {
    throw new BasaltError({
      code: "E_DEPENDENCY_MISSING",
      frameworkId,
      plugin: record.name,
      message: names.has(dependency.name)
        ? `Plugin "${record.name}" depends on "${dependency.name}", but the "${dependency.name}" in this app is a different definition.`
        : `Plugin "${record.name}" depends on "${dependency.name}", which is not in the plugin list.`,
      hint: names.has(dependency.name)
        ? "Dependencies are matched by identity. Register the same definition you list in depends."
        : `Add "${dependency.name}" before "${record.name}" in your plugin list.`
    });
  }
  if (position > index) {
    throw new BasaltError({
      code: "E_DEPENDENCY_ORDER",
      frameworkId,
      plugin: record.name,
      message: `Plugin "${record.name}" depends on "${dependency.name}", but "${dependency.name}" appears after "${record.name}".`,
      hint: `Move "${dependency.name}" before "${record.name}" in your plugin list.`
    });
  }
}

/**
 * Checks a `pluginConfigs` (or `serviceConfigs`) map: an object whose keys name
 * configurable plugins or services in the list.
 *
 * @param framework - The framework.
 * @param entries - The plugin list (empty for `serviceConfigs`).
 * @param overrides - The override map.
 * @param option - The option name, for error messages.
 * @throws {BasaltError} `E_CONFIG_INVALID`.
 * @example
 * ```ts
 * validateOverrideKeys(frameworkRecord, entries, { router: { basePath: "/" } }, "pluginConfigs");
 * ```
 */
export function validateOverrideKeys(
  framework: FrameworkRecord,
  entries: readonly PlanEntry[],
  overrides: unknown,
  option: string
): void {
  if (overrides === undefined) return;
  if (!isPlainObject(overrides)) {
    throw new BasaltError({
      code: "E_CONFIG_INVALID",
      frameworkId: framework.id,
      message: `"${option}" must be a plain object keyed by plugin or service name.`,
      hint: `Write ${option}: { router: { basePath: "/" } }.`
    });
  }
  const configurable = new Map<string, boolean>();
  for (const service of framework.services)
    configurable.set(service.name, service.config !== undefined);
  for (const { record } of entries) configurable.set(record.name, record.config !== undefined);
  for (const key of Object.keys(overrides)) {
    const hasConfig = configurable.get(key);
    if (hasConfig === true) continue;
    throw new BasaltError({
      code: "E_CONFIG_INVALID",
      frameworkId: framework.id,
      plugin: key,
      message:
        hasConfig === false
          ? `"${option}.${key}" is set, but "${key}" has no config.`
          : `"${option}.${key}" doesn't match any plugin or service in this app.`,
      hint: `Remove "${key}" from ${option}, or check its spelling.`
    });
  }
}
