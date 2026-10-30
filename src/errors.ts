/**
 * Every error code the kernel can raise. See `docs/basalt-design.md` §30.
 *
 * @example
 * ```ts
 * if (error instanceof BasaltError && error.code === "E_DEPENDENCY_ORDER") {
 *   // reorder the plugin list
 * }
 * ```
 */
export type BasaltErrorCode =
  | "E_INVALID_NAME"
  | "E_INVALID_SPEC"
  | "E_CONFIG_INVALID"
  | "E_FOREIGN_PLUGIN"
  | "E_DUPLICATE_NAME"
  | "E_DEPENDENCY_MISSING"
  | "E_DEPENDENCY_ORDER"
  | "E_UNDECLARED_DEPENDENCY"
  | "E_NOT_READY"
  | "E_EVENT_NAMESPACE"
  | "E_EVENT_CONFLICT"
  | "E_UNKNOWN_EVENT"
  | "E_UNKNOWN_HOOK"
  | "E_EMIT_DURING_WIRING"
  | "E_HANDLER_FAILED"
  | "E_INVALID_STATE"
  | "E_START_FAILED"
  | "E_STOP_FAILED"
  | "E_EMIT_AFTER_STOP";

/**
 * Constructor input for {@link BasaltError}.
 *
 * @example
 * ```ts
 * const options: BasaltErrorOptions = {
 *   code: "E_INVALID_NAME",
 *   frameworkId: "site",
 *   message: 'Plugin name "b-events" is not a valid identifier.',
 *   hint: "Use a camelCase name such as \"bEvents\"."
 * };
 * ```
 */
export interface BasaltErrorOptions {
  /** The error code. */
  readonly code: BasaltErrorCode;
  /** Id of the framework that raised the error, or `"basalt"` before a framework exists. */
  readonly frameworkId: string;
  /** What went wrong, as one sentence. */
  readonly message: string;
  /** What to do about it, as one sentence. */
  readonly hint: string;
  /** The plugin, service or lifecycle target the error is about. */
  readonly plugin?: string;
  /** The underlying error, if any. */
  readonly cause?: unknown;
}

/**
 * The single error type the kernel throws, rejects with, or reports to `onError`.
 * The message reads `[framework-id] Description. [E_CODE]` followed by an indented hint.
 *
 * @example
 * ```ts
 * try {
 *   await createApp({ plugins: [seoPlugin, routerPlugin] });
 * } catch (error) {
 *   if (error instanceof BasaltError) console.error(error.code, error.plugin);
 * }
 * ```
 */
export class BasaltError extends Error {
  /** Always `"BasaltError"`. */
  override readonly name: string = "BasaltError";
  /** The error code (§30). */
  readonly code: BasaltErrorCode;
  /** Id of the framework that raised the error. */
  readonly frameworkId: string;
  /** The plugin, service or lifecycle target the error is about, when there is one. */
  readonly plugin: string | undefined;

  /**
   * Builds the error and formats its message.
   *
   * @param options - Code, framework id, message, hint and optional plugin and cause.
   * @example
   * ```ts
   * throw new BasaltError({ code: "E_INVALID_STATE", frameworkId: "site", message: "…", hint: "…" });
   * ```
   */
  constructor(options: BasaltErrorOptions) {
    super(
      `[${options.frameworkId}] ${options.message} [${options.code}]\n  ${options.hint}`,
      "cause" in options ? { cause: options.cause } : undefined
    );
    this.code = options.code;
    this.frameworkId = options.frameworkId;
    this.plugin = options.plugin;
  }
}

/**
 * Frames a value for an error message: strings are quoted, everything else is described by type.
 *
 * @param value - The value to describe.
 * @returns A short, human-readable description.
 * @example
 * ```ts
 * describeValue("router"); // '"router"'
 * describeValue(42);       // "a number"
 * ```
 */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
