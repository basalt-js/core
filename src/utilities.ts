import { BasaltError } from "./errors";

/** Framework id used in errors raised before any framework exists. */
export const KERNEL_ID = "basalt";

/**
 * Names that can't be used for plugins, services or packs, because they are app or
 * context members (§30).
 *
 * @example
 * ```ts
 * RESERVED_NAMES.has("emit"); // true
 * ```
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "start",
  "stop",
  "status",
  "settled",
  "emit",
  "dispatch",
  "collect",
  "pipe",
  "get",
  "find",
  "has",
  "shared",
  "inspect",
  "global",
  "config",
  "state",
  "signal",
  "services",
  "basalt"
]);

const NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/**
 * Checks a plugin, service or pack name: a camelCase identifier that is neither
 * reserved nor an `Object.prototype` key.
 *
 * @param frameworkId - Framework id for the error message.
 * @param what - What is being named, for the error message.
 * @param name - The name to check.
 * @throws {BasaltError} `E_INVALID_NAME`.
 * @example
 * ```ts
 * assertName("site", "Plugin", "router"); // ok
 * assertName("site", "Plugin", "b-events"); // throws E_INVALID_NAME
 * ```
 */
export function assertName(
  frameworkId: string,
  what: "Plugin" | "Service" | "Pack",
  name: unknown
): asserts name is string {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    const shown = typeof name === "string" ? JSON.stringify(name) : `(a ${typeof name})`;
    throw new BasaltError({
      code: "E_INVALID_NAME",
      frameworkId,
      message: `${what} name ${shown} is not a valid identifier.`,
      hint: 'Use a camelCase name that starts with a lowercase letter, such as "router" or "pageViews".'
    });
  }
  if (RESERVED_NAMES.has(name) || name in Object.prototype) {
    throw new BasaltError({
      code: "E_INVALID_NAME",
      frameworkId,
      message: `${what} name "${name}" is reserved.`,
      hint: `Pick another name. Reserved: ${[...RESERVED_NAMES].join(", ")}, and Object.prototype keys.`
    });
  }
}

/**
 * Whether a value is a plain object: created by `{}` or `Object.create(null)`.
 *
 * @param value - The value to test.
 * @returns `true` for plain objects.
 * @example
 * ```ts
 * isPlainObject({ a: 1 }); // true
 * isPlainObject([]);       // false
 * ```
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a value is a thenable (a promise or promise-like).
 *
 * @param value - The value to test.
 * @returns `true` if it has a callable `then`.
 * @example
 * ```ts
 * isThenable(Promise.resolve()); // true
 * ```
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Freezes plain objects and arrays recursively. Other objects (class instances,
 * schemas, functions) are left alone, because freezing them could break them.
 *
 * @param value - The value to freeze.
 * @returns The same value.
 * @example
 * ```ts
 * const frozen = deepFreeze({ nested: { a: 1 } });
 * Object.isFrozen(frozen.nested); // true
 * ```
 */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value) || isPlainObject(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Throws `E_INVALID_SPEC` unless every listed field is absent or a function.
 *
 * @param frameworkId - Framework id for the error message.
 * @param owner - Description of the spec owner, e.g. `Plugin "router"`.
 * @param spec - The spec object.
 * @param fields - Field names that must be functions when present.
 * @throws {BasaltError} `E_INVALID_SPEC`.
 * @example
 * ```ts
 * assertFunctions("site", 'Plugin "router"', spec, ["api", "onInit"]);
 * ```
 */
export function assertFunctions(
  frameworkId: string,
  owner: string,
  spec: Record<string, unknown>,
  fields: readonly string[]
): void {
  for (const field of fields) {
    const value = spec[field];
    if (value !== undefined && typeof value !== "function") {
      throw new BasaltError({
        code: "E_INVALID_SPEC",
        frameworkId,
        plugin: owner,
        message: `${owner}: "${field}" must be a function, got ${typeof value}.`,
        hint: `Write "${field}: ctx => …".`
      });
    }
  }
}

/**
 * Throws `E_INVALID_SPEC` if an options or spec object has keys outside `allowed`.
 *
 * @param frameworkId - Framework id for the error message.
 * @param owner - Description of the object, e.g. `Plugin "router"`.
 * @param value - The object to check.
 * @param allowed - The keys it may have.
 * @param renamed - Known old names mapped to their replacements, for a better hint.
 * @throws {BasaltError} `E_INVALID_SPEC`.
 * @example
 * ```ts
 * assertKnownKeys("site", 'Plugin "router"', spec, PLUGIN_FIELDS, { createState: "state" });
 * ```
 */
export function assertKnownKeys(
  frameworkId: string,
  owner: string,
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  renamed: Readonly<Record<string, string>> = {}
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    const replacement = renamed[key];
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId,
      message: `${owner} has an unknown field "${key}".`,
      hint:
        replacement === undefined
          ? `Allowed fields: ${[...allowed].join(", ")}.`
          : `Did you mean "${replacement}"?`
    });
  }
}

/**
 * Throws `E_INVALID_SPEC` unless a value is a plain object.
 *
 * @param frameworkId - Framework id for the error message.
 * @param owner - What the object is, e.g. `The spec of plugin "router"`.
 * @param value - The value to check.
 * @param hint - What to do instead.
 * @throws {BasaltError} `E_INVALID_SPEC`.
 * @example
 * ```ts
 * assertObject("site", 'The spec of plugin "router"', spec, "Pass an object literal.");
 * ```
 */
export function assertObject(
  frameworkId: string,
  owner: string,
  value: unknown,
  hint: string
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new BasaltError({
      code: "E_INVALID_SPEC",
      frameworkId,
      message: `${owner} must be a plain object.`,
      hint
    });
  }
}

/**
 * Reports an error to the host console. The kernel's last-resort reporter: errors
 * are never silently dropped (B6).
 *
 * @param error - The error to print.
 * @example
 * ```ts
 * reportToConsole(new Error("boom"));
 * ```
 */
export function reportToConsole(error: unknown): void {
  const host = globalThis as { console?: { error?: (...data: unknown[]) => void } };
  host.console?.error?.(error);
}
