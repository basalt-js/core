// =============================================================================
// Internal records behind the public, frozen definitions. Definitions are plain
// objects; the kernel looks up their normalised specs here, by identity.
// =============================================================================

import type { CatalogEntry } from "./types";

/**
 * A spec function, called with a context object the kernel builds.
 *
 * @example
 * ```ts
 * const api: ContextFunction = context => ({});
 * ```
 */
export type ContextFunction = (context: Record<string, unknown>) => unknown;

/**
 * The normalised spec of a service.
 *
 * @example
 * ```ts
 * const record = services.get(logService);
 * ```
 */
export interface ServiceRecord {
  /** The public definition. */
  readonly definition: object;
  /** The service name. */
  readonly name: string;
  /** Defaults, a schema, or undefined. */
  readonly config: unknown;
  /** Services this one uses. */
  readonly depends: readonly ServiceRecord[];
  /** State factory. */
  readonly state: ContextFunction | undefined;
  /** API factory. */
  readonly api: ContextFunction | undefined;
  /** Init hook. */
  readonly onInit: ContextFunction | undefined;
  /** Start hook. */
  readonly onStart: ContextFunction | undefined;
  /** Stop hook. */
  readonly onStop: ContextFunction | undefined;
}

/**
 * The normalised spec of a plugin.
 *
 * @example
 * ```ts
 * const record = plugins.get(routerPlugin);
 * ```
 */
export interface PluginRecord {
  /** The public definition. */
  readonly definition: object;
  /** The plugin name. */
  readonly name: string;
  /** The framework that defined it. */
  readonly framework: FrameworkRecord;
  /** Defaults, a schema, or undefined. */
  readonly config: unknown;
  /** Own events. */
  readonly catalog: readonly CatalogEntry[];
  /** Required dependencies. */
  readonly depends: readonly PluginRecord[];
  /** Optional dependencies. */
  readonly optionalDepends: readonly PluginRecord[];
  /** State factory. */
  readonly state: ContextFunction | undefined;
  /** API factory. */
  readonly api: ContextFunction | undefined;
  /** Hooks factory. */
  readonly hooks: ContextFunction | undefined;
  /** Init hook. */
  readonly onInit: ContextFunction | undefined;
  /** Start hook. */
  readonly onStart: ContextFunction | undefined;
  /** Stop hook. */
  readonly onStop: ContextFunction | undefined;
}

/**
 * A pack: a named, ordered group of plugins.
 *
 * @example
 * ```ts
 * const record = packs.get(stagePack);
 * ```
 */
export interface PackRecord {
  /** The pack name. */
  readonly name: string;
  /** The framework it was made for. */
  readonly framework: FrameworkRecord;
  /** Its plugins, in order. */
  readonly plugins: readonly PluginRecord[];
}

/**
 * The normalised options of a framework.
 *
 * @example
 * ```ts
 * const record = frameworks.get(site);
 * ```
 */
export interface FrameworkRecord {
  /** The framework id. */
  readonly id: string;
  /** Global config defaults, a schema, or undefined. */
  readonly config: unknown;
  /** Global events. */
  readonly catalog: readonly CatalogEntry[];
  /** Services, in order. */
  readonly services: readonly ServiceRecord[];
  /** Framework-level service overrides, keyed by service name. */
  readonly serviceConfigs: Readonly<Record<string, unknown>>;
}

/** Service definition → record. */
export const services: WeakMap<object, ServiceRecord> = new WeakMap();
/** Plugin definition → record. */
export const plugins: WeakMap<object, PluginRecord> = new WeakMap();
/** Pack → record. */
export const packs: WeakMap<object, PackRecord> = new WeakMap();
