import { assertConfigSpec } from "./config";
import { BasaltError, describeValue } from "./errors";
import { type ContextFunction, type ServiceRecord, services } from "./registry";
import type { AnyService, ConfigSpec, DefinedService, EmptyObject, ServiceSpec } from "./types";
import {
  assertFunctions,
  assertKnownKeys,
  assertName,
  assertObject,
  deepFreeze,
  KERNEL_ID
} from "./utilities";

const SERVICE_FIELDS: ReadonlySet<string> = new Set([
  "config",
  "depends",
  "state",
  "api",
  "onInit",
  "onStart",
  "onStop"
]);

const LIFECYCLE_FIELDS = ["state", "api", "onInit", "onStart", "onStop"] as const;

/**
 * Defines a service: self-contained infrastructure (logging, env, clock) whose API is
 * injected flat on every plugin context and mounted on the app. Services sit below
 * the event graph: no events, no hooks. They init and start before every plugin and
 * stop after every plugin.
 *
 * @param name - camelCase service name, also its key on contexts and the app.
 * @param spec - `config`, `depends`, `state`, `api`, `onInit`, `onStart`, `onStop`.
 * @returns A frozen service definition, passed to `defineFramework({ services })`.
 * @throws {BasaltError} `E_INVALID_NAME`, `E_INVALID_SPEC`.
 * @example
 * ```ts
 * export const logService = defineService("log", {
 *   config: { level: "info" as "debug" | "info" | "warn" },
 *   api: ({ config }) => ({ info: (message: string) => write(config.level, message) })
 * });
 * ```
 */
export function defineService<
  const N extends string,
  CS extends ConfigSpec | undefined = undefined,
  S = EmptyObject,
  A = EmptyObject,
  const D extends readonly AnyService[] = readonly []
>(name: N, spec: ServiceSpec<CS, S, A, D>): DefinedService<N, CS, S, A> {
  assertName(KERNEL_ID, "Service", name);
  const owner = `Service "${name}"`;
  assertObject(KERNEL_ID, `The spec of service "${name}"`, spec, "Pass an object literal.");
  if ("events" in spec || "hooks" in spec) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: KERNEL_ID,
      plugin: name,
      message: `${owner} declares events or hooks, but services sit below the event graph.`,
      hint: "Make it a plugin, or expose a method on the service API instead."
    });
  }
  assertKnownKeys(KERNEL_ID, owner, spec, SERVICE_FIELDS, { createState: "state" });
  assertConfigSpec(
    { frameworkId: KERNEL_ID, label: `service "${name}"`, plugin: name, overridePath: "config" },
    spec.config
  );
  assertFunctions(KERNEL_ID, owner, spec, LIFECYCLE_FIELDS);
  const depends = resolveServiceDepends(name, spec.depends);

  const normalised = deepFreeze({ ...spec, depends: depends.map(record => record.definition) });
  const definition = Object.freeze({
    kind: "service" as const,
    name,
    spec: normalised,
    _phantom: Object.freeze({})
  });
  const record: ServiceRecord = {
    definition,
    name,
    config: spec.config,
    depends,
    state: spec.state as ContextFunction | undefined,
    api: spec.api as ContextFunction | undefined,
    onInit: spec.onInit as ContextFunction | undefined,
    onStart: spec.onStart as ContextFunction | undefined,
    onStop: spec.onStop as ContextFunction | undefined
  };
  services.set(definition, record);
  return definition as unknown as DefinedService<N, CS, S, A>;
}

/**
 * Resolves a service's `depends` list into records.
 *
 * @param name - The service being defined.
 * @param depends - The `depends` field.
 * @returns The dependency records, in order.
 * @throws {BasaltError} `E_INVALID_SPEC`.
 * @example
 * ```ts
 * resolveServiceDepends("log", [envService]);
 * ```
 */
function resolveServiceDepends(name: string, depends: unknown): readonly ServiceRecord[] {
  if (depends === undefined) return [];
  if (!Array.isArray(depends)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId: KERNEL_ID,
      plugin: name,
      message: `Service "${name}": "depends" must be an array of services, got ${describeValue(depends)}.`,
      hint: "Write depends: [envService]."
    });
  }
  return depends.map((dependency: unknown) => {
    const record =
      typeof dependency === "object" && dependency !== null ? services.get(dependency) : undefined;
    if (record === undefined) {
      throw new BasaltError({
        code: "E_INVALID_SPEC",
        frameworkId: KERNEL_ID,
        plugin: name,
        message: `Service "${name}" depends on ${describeValue(dependency)}, which is not a service definition.`,
        hint: "Services can only depend on other services made with defineService."
      });
    }
    return record;
  });
}
