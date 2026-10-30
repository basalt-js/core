import { assertConfigSpec } from "./config";
import { BasaltError, describeValue } from "./errors";
import { buildCatalog } from "./event";
import { type ContextFunction, type FrameworkRecord, type PluginRecord, plugins } from "./registry";
import {
  assertFunctions,
  assertKnownKeys,
  assertName,
  assertObject,
  deepFreeze,
  isPlainObject
} from "./utilities";

const PLUGIN_FIELDS: ReadonlySet<string> = new Set([
  "config",
  "events",
  "depends",
  "optionalDepends",
  "state",
  "api",
  "hooks",
  "onInit",
  "onStart",
  "onStop",
  "helpers"
]);

/** Moku field names that changed in Basalt, for "did you mean" hints. */
const RENAMED_FIELDS: Readonly<Record<string, string>> = {
  createState: "state",
  dependencies: "depends",
  optionalDependencies: "optionalDepends"
};

const FUNCTION_FIELDS = ["state", "api", "hooks", "onInit", "onStart", "onStop"] as const;

/** Keys of a definition that helpers can't overwrite. */
const DEFINITION_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "framework",
  "name",
  "spec",
  "catalog",
  "_phantom"
]);

/**
 * Builds the runtime `definePlugin` for one framework. Types are applied by the caller.
 *
 * @param framework - The framework record the plugins belong to.
 * @returns A function `(name, spec) => definition`.
 * @example
 * ```ts
 * const definePlugin = createPluginFactory(frameworkRecord);
 * const routerPlugin = definePlugin("router", { config: { basePath: "/" } });
 * ```
 */
export function createPluginFactory(
  framework: FrameworkRecord
): (name: unknown, spec: unknown) => object {
  return (name, spec) => definePluginRecord(framework, name, spec).definition;
}

/**
 * Validates a plugin spec, freezes it, and registers the definition.
 *
 * @param framework - The owning framework.
 * @param name - The plugin name.
 * @param spec - The spec object.
 * @returns The new record.
 * @throws {BasaltError} `E_INVALID_NAME`, `E_INVALID_SPEC`, `E_EVENT_NAMESPACE`, `E_FOREIGN_PLUGIN`.
 * @example
 * ```ts
 * definePluginRecord(frameworkRecord, "router", { config: { basePath: "/" } });
 * ```
 */
function definePluginRecord(
  framework: FrameworkRecord,
  name: unknown,
  spec: unknown
): PluginRecord {
  const frameworkId = framework.id;
  assertName(frameworkId, "Plugin", name);
  const owner = `Plugin "${name}"`;
  assertObject(frameworkId, `The spec of plugin "${name}"`, spec, "Pass an object literal.");
  assertKnownKeys(frameworkId, owner, spec, PLUGIN_FIELDS, RENAMED_FIELDS);
  assertConfigSpec(
    { frameworkId, label: `plugin "${name}"`, plugin: name, overridePath: `pluginConfigs.${name}` },
    spec.config
  );
  assertFunctions(frameworkId, owner, spec, FUNCTION_FIELDS);
  const catalog = buildCatalog(frameworkId, spec.events, name);
  const depends = resolvePluginDepends(framework, name, "depends", spec.depends);
  const optionalDepends = resolvePluginDepends(
    framework,
    name,
    "optionalDepends",
    spec.optionalDepends
  );
  const helpers = resolveHelpers(frameworkId, name, spec.helpers);

  const normalised = deepFreeze({
    ...spec,
    depends: depends.map(record => record.definition),
    optionalDepends: optionalDepends.map(record => record.definition)
  });
  const definition = Object.freeze({
    kind: "plugin" as const,
    framework: frameworkId,
    name,
    spec: normalised,
    catalog,
    _phantom: Object.freeze({}),
    ...helpers
  });
  const record: PluginRecord = {
    definition,
    name,
    framework,
    config: spec.config,
    catalog,
    depends,
    optionalDepends,
    state: spec.state as ContextFunction | undefined,
    api: spec.api as ContextFunction | undefined,
    hooks: spec.hooks as ContextFunction | undefined,
    onInit: spec.onInit as ContextFunction | undefined,
    onStart: spec.onStart as ContextFunction | undefined,
    onStop: spec.onStop as ContextFunction | undefined
  };
  plugins.set(definition, record);
  return record;
}

/**
 * Resolves `depends` or `optionalDepends` into records of the same framework.
 *
 * @param framework - The owning framework.
 * @param name - The plugin being defined.
 * @param field - Which field is being read.
 * @param value - The field value.
 * @returns The dependency records, in order.
 * @throws {BasaltError} `E_INVALID_SPEC` or `E_FOREIGN_PLUGIN`.
 * @example
 * ```ts
 * resolvePluginDepends(frameworkRecord, "seo", "depends", [routerPlugin]);
 * ```
 */
function resolvePluginDepends(
  framework: FrameworkRecord,
  name: string,
  field: "depends" | "optionalDepends",
  value: unknown
): readonly PluginRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: framework.id,
      plugin: name,
      message: `Plugin "${name}": "${field}" must be an array of plugins, got ${describeValue(value)}.`,
      hint: `Write ${field}: [routerPlugin].`
    });
  }
  return value.map((dependency: unknown) => {
    const record =
      typeof dependency === "object" && dependency !== null ? plugins.get(dependency) : undefined;
    if (record === undefined) {
      throw new BasaltError({
        code: "E_INVALID_SPEC",
        frameworkId: framework.id,
        plugin: name,
        message: `Plugin "${name}" lists ${describeValue(dependency)} in "${field}", which is not a plugin definition.`,
        hint: "List plugin definitions (the value definePlugin returned), not names."
      });
    }
    if (record.framework !== framework) {
      throw new BasaltError({
        code: "E_FOREIGN_PLUGIN",
        frameworkId: framework.id,
        plugin: name,
        message: `Plugin "${name}" lists "${record.name}" in "${field}", but "${record.name}" belongs to framework "${record.framework.id}".`,
        hint: `Plugins can only depend on plugins of the same framework ("${framework.id}").`
      });
    }
    return record;
  });
}

/**
 * Validates the `helpers` field.
 *
 * @param frameworkId - Framework id for error messages.
 * @param name - The plugin being defined.
 * @param helpers - The field value.
 * @returns The helpers object (empty when absent).
 * @throws {BasaltError} `E_INVALID_SPEC`.
 * @example
 * ```ts
 * resolveHelpers("site", "router", { route: (path: string) => ({ path }) });
 * ```
 */
function resolveHelpers(
  frameworkId: string,
  name: string,
  helpers: unknown
): Record<string, unknown> {
  if (helpers === undefined) return {};
  if (!isPlainObject(helpers)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId,
      plugin: name,
      message: `Plugin "${name}": "helpers" must be a plain object of functions.`,
      hint: "Write helpers: { route: (path: string) => … }."
    });
  }
  for (const [key, helper] of Object.entries(helpers)) {
    if (typeof helper !== "function" || DEFINITION_KEYS.has(key)) {
      throw new BasaltError({
        code: "E_INVALID_SPEC",
        frameworkId,
        plugin: name,
        message:
          typeof helper === "function"
            ? `Plugin "${name}": helper "${key}" collides with a definition field.`
            : `Plugin "${name}": helper "${key}" must be a function, got ${typeof helper}.`,
        hint: `Helpers are functions, and can't be named ${[...DEFINITION_KEYS].join(", ")}.`
      });
    }
  }
  return helpers;
}
