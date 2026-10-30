import { BasaltError } from "./errors";
import type {
  StandardSchemaIssue,
  StandardSchemaPathSegment,
  StandardSchemaResult,
  StandardSchemaV1
} from "./types";
import { isPlainObject, isThenable } from "./utilities";

/**
 * Who a config belongs to, for error messages.
 *
 * @example
 * ```ts
 * const target: ConfigTarget = { frameworkId: "site", label: 'plugin "router"', plugin: "router" };
 * ```
 */
export interface ConfigTarget {
  /** Framework id. */
  readonly frameworkId: string;
  /** Human-readable owner, e.g. `plugin "router"` or `the global config`. */
  readonly label: string;
  /** Plugin or service name, when the config belongs to one. */
  readonly plugin?: string;
  /** Where overrides are written, e.g. `pluginConfigs.router`. */
  readonly overridePath: string;
}

/**
 * Whether a value implements Standard Schema. Objects and functions (ArkType) qualify.
 *
 * @param value - The value to test.
 * @returns `true` if it has a `~standard.validate` function.
 * @example
 * ```ts
 * isStandardSchema(z.object({})); // true
 * isStandardSchema({ port: 80 }); // false
 * ```
 */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const properties = (value as { "~standard"?: { validate?: unknown } })["~standard"];
  return (
    typeof properties === "object" &&
    properties !== null &&
    typeof properties.validate === "function"
  );
}

/**
 * Checks a `config` field: absent, a plain default object, or a Standard Schema.
 *
 * @param target - Who the config belongs to.
 * @param config - The `config` field.
 * @throws {BasaltError} `E_INVALID_SPEC`.
 * @example
 * ```ts
 * assertConfigSpec(target, { basePath: "/" });
 * ```
 */
export function assertConfigSpec(target: ConfigTarget, config: unknown): void {
  if (config === undefined || isPlainObject(config) || isStandardSchema(config)) return;
  throw new BasaltError({
    code: "E_INVALID_SPEC",
    frameworkId: target.frameworkId,
    ...(target.plugin === undefined ? {} : { plugin: target.plugin }),
    message: `The config of ${target.label} must be a plain object of defaults or a Standard Schema.`,
    hint: "Write config: { … } with every default, or config: z.object({ … })."
  });
}

/**
 * Resolves a config: shallow-merges the overrides in order, then either applies them
 * over the defaults or runs the schema. Returns synchronously unless the schema's
 * `validate` returned a promise.
 *
 * @param target - Who the config belongs to.
 * @param spec - The `config` field: defaults, a schema, or undefined.
 * @param overrides - Override objects, lowest precedence first. `undefined` entries are skipped.
 * @returns The frozen config, or a promise of it.
 * @throws {BasaltError} `E_CONFIG_INVALID`.
 * @example
 * ```ts
 * resolveConfig(target, { basePath: "/" }, [undefined, { basePath: "/blog" }]); // { basePath: "/blog" }
 * ```
 */
export function resolveConfig(
  target: ConfigTarget,
  spec: unknown,
  overrides: readonly unknown[]
): object | Promise<object> {
  const merged: Record<string, unknown> = {};
  for (const override of overrides) {
    if (override === undefined) continue;
    if (!isPlainObject(override)) {
      throw configError(target, [`${target.overridePath} must be a plain object.`]);
    }
    Object.assign(merged, override);
  }

  if (isStandardSchema(spec)) {
    const result = spec["~standard"].validate(merged);
    return isThenable(result)
      ? Promise.resolve(result).then(settledResult => finishSchema(target, settledResult))
      : finishSchema(target, result);
  }

  const defaults = spec ?? {};
  const unknownKeys = Object.keys(merged).filter(key => !Object.hasOwn(defaults, key));
  if (unknownKeys.length > 0) {
    throw configError(
      target,
      unknownKeys.map(key => `${key}: not a config field of ${target.label}`)
    );
  }
  return Object.freeze({ ...defaults, ...merged });
}

/**
 * Turns a schema result into a frozen config or an `E_CONFIG_INVALID` error.
 *
 * @param target - Who the config belongs to.
 * @param result - The schema's validation result.
 * @returns The frozen config.
 * @throws {BasaltError} `E_CONFIG_INVALID`.
 * @example
 * ```ts
 * finishSchema(target, { value: { port: 80 } }); // { port: 80 }
 * ```
 */
function finishSchema(target: ConfigTarget, result: StandardSchemaResult<unknown>): object {
  if (result.issues)
    throw configError(
      target,
      result.issues.map(issue => formatIssue(issue))
    );
  const value = result.value;
  if (typeof value !== "object" || value === null) {
    throw configError(target, [`the schema produced ${typeof value}, not an object`]);
  }
  return Object.freeze(value);
}

/**
 * Formats one schema issue as `path: message`.
 *
 * @param issue - The issue.
 * @returns The formatted line.
 * @example
 * ```ts
 * formatIssue({ message: "Required", path: ["trackingId"] }); // "trackingId: Required"
 * ```
 */
function formatIssue(issue: StandardSchemaIssue): string {
  const path = (issue.path ?? [])
    .map(segment => String(isPathSegment(segment) ? segment.key : segment))
    .join(".");
  return `${path || "(root)"}: ${issue.message}`;
}

/**
 * Whether a path entry is a `{ key }` segment rather than a bare key.
 *
 * @param segment - The path entry.
 * @returns `true` for `{ key }` segments.
 * @example
 * ```ts
 * isPathSegment({ key: "a" }); // true
 * ```
 */
function isPathSegment(
  segment: PropertyKey | StandardSchemaPathSegment
): segment is StandardSchemaPathSegment {
  return typeof segment === "object";
}

/**
 * Builds an `E_CONFIG_INVALID` error listing every problem.
 *
 * @param target - Who the config belongs to.
 * @param problems - One line per problem.
 * @returns The error.
 * @example
 * ```ts
 * throw configError(target, ["trackingId: Required"]);
 * ```
 */
function configError(target: ConfigTarget, problems: readonly string[]): BasaltError {
  return new BasaltError({
    code: "E_CONFIG_INVALID",
    frameworkId: target.frameworkId,
    ...(target.plugin === undefined ? {} : { plugin: target.plugin }),
    message: `The config of ${target.label} is invalid.`,
    hint: [`Fix ${target.overridePath}:`, ...problems.map(line => `    - ${line}`)].join("\n")
  });
}
