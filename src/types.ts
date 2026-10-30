// =============================================================================
// Public types. No runtime code lives here (coverage excludes this file).
// See docs/basalt-design.md §31 for the type-system plan.
// =============================================================================

import type { BasaltError } from "./errors";

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * An object type with no keys. Used as the identity default instead of `{}` or
 * `Record<string, never>`, whose string index would turn intersected keys into `never`.
 *
 * @example
 * ```ts
 * type NoApi = EmptyObject; // keyof NoApi is never
 * ```
 */
export type EmptyObject = Record<never, never>;

/**
 * Turns a union into an intersection: `A | B` becomes `A & B`.
 *
 * @example
 * ```ts
 * type Both = UnionToIntersection<{ a: 1 } | { b: 2 }>; // { a: 1 } & { b: 2 }
 * ```
 */
export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I
) => void
  ? I
  : never;

/**
 * Flattens an intersection into one object type so editor tooltips stay readable.
 *
 * @example
 * ```ts
 * type Flat = Prettify<{ a: 1 } & { b: 2 }>; // { a: 1; b: 2 }
 * ```
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * `true` when `S` is a string literal, `false` for the wide `string` type.
 *
 * @example
 * ```ts
 * type A = IsLiteralString<"router">; // true
 * type B = IsLiteralString<string>;   // false
 * ```
 */
export type IsLiteralString<S> = string extends S ? false : S extends string ? true : false;

/**
 * The keys of `T` that are not optional.
 *
 * @example
 * ```ts
 * type K = RequiredKeysOf<{ a: string; b?: number }>; // "a"
 * ```
 */
export type RequiredKeysOf<T> = T extends object
  ? { [K in keyof T]-?: EmptyObject extends Pick<T, K> ? never : K }[keyof T]
  : never;

// ─── Standard Schema (copied from https://standardschema.dev, v1) ────────────

/**
 * The Standard Schema interface that Zod, Valibot, ArkType and others implement.
 * The kernel copies the type definitions so it keeps zero runtime dependencies.
 *
 * @example
 * ```ts
 * const schema: StandardSchemaV1<{ port?: number }, { port: number }> = z.object({
 *   port: z.number().default(8080)
 * });
 * ```
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaProperties<Input, Output>;
}

/**
 * The `~standard` property of a Standard Schema.
 *
 * @example
 * ```ts
 * const result = await schema["~standard"].validate({ port: 80 });
 * ```
 */
export interface StandardSchemaProperties<Input = unknown, Output = Input> {
  /** The Standard Schema version. */
  readonly version: 1;
  /** The library that implements the schema. */
  readonly vendor: string;
  /** Validates a value. May return a promise. */
  readonly validate: (
    value: unknown
  ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  /** Type-only carrier for the input and output types. */
  readonly types?: StandardSchemaTypes<Input, Output> | undefined;
}

/**
 * The result of `validate`: a value, or a list of issues.
 *
 * @example
 * ```ts
 * const result: StandardSchemaResult<number> = { value: 1 };
 * ```
 */
export type StandardSchemaResult<Output> = StandardSchemaSuccess<Output> | StandardSchemaFailure;

/**
 * A successful validation.
 *
 * @example
 * ```ts
 * const ok: StandardSchemaSuccess<number> = { value: 1 };
 * ```
 */
export interface StandardSchemaSuccess<Output> {
  /** The validated (and possibly transformed) value. */
  readonly value: Output;
  /** Always absent on success. */
  readonly issues?: undefined;
}

/**
 * A failed validation.
 *
 * @example
 * ```ts
 * const failed: StandardSchemaFailure = { issues: [{ message: "Required", path: ["port"] }] };
 * ```
 */
export interface StandardSchemaFailure {
  /** Every problem found. */
  readonly issues: readonly StandardSchemaIssue[];
}

/**
 * One validation problem.
 *
 * @example
 * ```ts
 * const issue: StandardSchemaIssue = { message: "Expected a number", path: ["port"] };
 * ```
 */
export interface StandardSchemaIssue {
  /** What is wrong. */
  readonly message: string;
  /** Where it is wrong. */
  readonly path?: readonly (PropertyKey | StandardSchemaPathSegment)[] | undefined;
}

/**
 * A path segment that wraps its key.
 *
 * @example
 * ```ts
 * const segment: StandardSchemaPathSegment = { key: "port" };
 * ```
 */
export interface StandardSchemaPathSegment {
  /** The key. */
  readonly key: PropertyKey;
}

/**
 * Type-only carrier for a schema's input and output types.
 *
 * @example
 * ```ts
 * type In = StandardSchemaTypes<{ a?: number }, { a: number }>["input"];
 * ```
 */
export interface StandardSchemaTypes<Input, Output> {
  /** The type the schema accepts. */
  readonly input: Input;
  /** The type the schema produces. */
  readonly output: Output;
}

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * What a `config` field accepts: a complete default object or a Standard Schema.
 *
 * @example
 * ```ts
 * const plain: ConfigSpec = { basePath: "/" };
 * const schema: ConfigSpec = z.object({ trackingId: z.string() });
 * ```
 */
export type ConfigSpec = object;

/**
 * The resolved config type (`ctx.config`) for a `config` field.
 *
 * @example
 * ```ts
 * type A = ConfigOutput<{ basePath: string }>;                      // { basePath: string }
 * type B = ConfigOutput<StandardSchemaV1<{ a?: number }, { a: number }>>; // { a: number }
 * ```
 */
export type ConfigOutput<CS> = [CS] extends [undefined]
  ? EmptyObject
  : CS extends StandardSchemaV1
    ? NonNullable<CS["~standard"]["types"]>["output"]
    : CS;

/**
 * The type overrides are checked against. A plain default object makes every key
 * optional; a schema uses its input type, so keys without defaults stay required.
 * `never` means "this definition has no config".
 *
 * @example
 * ```ts
 * type A = ConfigInput<{ basePath: string }>; // { basePath?: string }
 * type B = ConfigInput<undefined>;            // never
 * ```
 */
export type ConfigInput<CS> = [CS] extends [undefined]
  ? never
  : CS extends StandardSchemaV1
    ? NonNullable<CS["~standard"]["types"]>["input"]
    : Partial<CS>;

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * How an event is delivered. M1 ships `notify`; `collect` and `pipe` arrive in M3.
 *
 * @example
 * ```ts
 * const kind: EventKind = "notify";
 * ```
 */
export type EventKind = "notify";

/**
 * A declared event, as produced by `event<P>()`. Carries its payload type at the
 * type level and its kind and description at runtime.
 *
 * @example
 * ```ts
 * const navigate: EventDescriptor<{ to: string }> = event<{ to: string }>("Route changed");
 * ```
 */
export interface EventDescriptor<P = unknown> {
  /** Delivery kind. */
  readonly kind: EventKind;
  /** Human-readable description, if one was given. */
  readonly description: string | undefined;
  /** Type-only payload carrier. Never set at runtime. */
  readonly _phantom?: { readonly payload: P };
}

/**
 * An event catalog: event names mapped to descriptors.
 *
 * @example
 * ```ts
 * const events: EventMap = { "router:navigate": event<{ to: string }>() };
 * ```
 */
export type EventMap = { readonly [name: string]: EventDescriptor };

/**
 * One normalised catalog entry, readable at runtime without building an app.
 *
 * @example
 * ```ts
 * routerPlugin.catalog; // [{ name: "router:navigate", kind: "notify", description: "Route changed" }]
 * ```
 */
export interface CatalogEntry {
  /** The event name. */
  readonly name: string;
  /** Delivery kind. */
  readonly kind: EventKind;
  /** Description, if one was given. */
  readonly description: string | undefined;
}

/**
 * The payload type carried by an event descriptor.
 *
 * @example
 * ```ts
 * type P = PayloadOf<EventDescriptor<{ to: string }>>; // { to: string }
 * ```
 */
export type PayloadOf<D> = D extends EventDescriptor<infer P> ? P : never;

/**
 * Turns an event catalog into a map of event name → payload type.
 *
 * @example
 * ```ts
 * type M = PayloadMap<{ "a:b": EventDescriptor<number> }>; // { "a:b": number }
 * ```
 */
export type PayloadMap<E> = { [K in keyof E]: PayloadOf<E[K]> };

/**
 * The argument list after the event name: none for `void` payloads, one otherwise.
 *
 * @example
 * ```ts
 * type A = PayloadArguments<void>;   // [payload?: undefined]
 * type B = PayloadArguments<number>; // [payload: number]
 * ```
 */
// biome-ignore lint/suspicious/noConfusingVoidType: `event()` defaults its payload to void; void must match here.
export type PayloadArguments<P> = [P] extends [void] ? [payload?: undefined] : [payload: P];

/**
 * A strictly typed `emit`, expressed as one overload per event. Overloads (rather
 * than a generic `K`) keep a context assignable to a narrower `PluginCtx` in
 * extracted domain files.
 *
 * @example
 * ```ts
 * declare const emit: EmitFunction<{ "router:navigate": { to: string } }>;
 * emit("router:navigate", { to: "/" });
 * ```
 */
export type EmitFunction<M> = [keyof M & string] extends [never]
  ? (name: never, ...rest: never[]) => void
  : UnionToIntersection<
      { [K in keyof M & string]: (name: K, ...rest: PayloadArguments<M[K]>) => void }[keyof M &
        string]
    >;

/**
 * A hook handler for an event with payload `P`.
 *
 * @example
 * ```ts
 * const onNavigate: HookHandler<{ to: string }> = ({ to }) => console.log(to);
 * ```
 */
export type HookHandler<P> = (payload: P) => void | Promise<void>;

/**
 * The handler map a `hooks` factory returns. Keys are inferred separately (`HK`)
 * and every key that is not a visible event maps to an error message type, which
 * rejects unknown hook names even when they are mixed with valid ones.
 *
 * @example
 * ```ts
 * type H = HookHandlers<{ "a:b": number }, { "a:b": unknown }>; // { "a:b": HookHandler<number> }
 * ```
 */
export type HookHandlers<V, HK> = {
  [K in keyof HK]: K extends keyof V
    ? HookHandler<V[K]>
    : `Unknown event "${K & string}": hooks can only name events from the framework, this plugin, or its depends/optionalDepends.`;
};

/**
 * Maps every event key that lacks the plugin's `name:` prefix to an error message type.
 *
 * @example
 * ```ts
 * type Bad = EventNamespaceCheck<"router", { "nav:go": EventDescriptor }>; // { "nav:go": "Event …" }
 * ```
 */
export type EventNamespaceCheck<N extends string, E> = {
  [K in Exclude<keyof E, `${N}:${string}`>]: `Event "${K & string}" must be named "${N}:<action>".`;
};

/**
 * Maps every framework event key that is not `domain:action`, or that uses the
 * reserved `basalt:` namespace, to an error message type.
 *
 * @example
 * ```ts
 * type Bad = GlobalEventCheck<{ render: EventDescriptor }>; // { render: "Event …" }
 * ```
 */
export type GlobalEventCheck<E> = {
  [K in
    | Exclude<keyof E, `${string}:${string}`>
    | Extract<
        keyof E,
        `basalt:${string}`
      >]: `Event "${K & string}" must be named "<domain>:<action>" outside the reserved "basalt:" namespace.`;
};

// ─── Definitions ─────────────────────────────────────────────────────────────

/**
 * The types a plugin definition carries in its phantom field.
 *
 * @example
 * ```ts
 * type RouterTypes = (typeof routerPlugin)["_phantom"];
 * ```
 */
export interface PluginTypes {
  /** Id of the framework that defined the plugin. */
  readonly framework: string;
  /** Resolved config (`ctx.config`). */
  readonly config: unknown;
  /** Override input type; `never` when the plugin has no config. */
  readonly input: unknown;
  /** Private state. */
  readonly state: unknown;
  /** Public API, mounted as `app[name]`. */
  readonly api: unknown;
  /** Own event catalog. */
  readonly events: EventMap;
}

/**
 * A frozen plugin definition, as returned by `definePlugin`.
 *
 * @example
 * ```ts
 * const routerPlugin: PluginDefinition<"router"> = definePlugin("router", { … });
 * routerPlugin.catalog; // the plugin's events, readable without an app
 * ```
 */
export interface PluginDefinition<N extends string = string, T extends PluginTypes = PluginTypes> {
  /** Always `"plugin"`. */
  readonly kind: "plugin";
  /** Id of the framework whose `definePlugin` created this definition. */
  readonly framework: T["framework"];
  /** The plugin name, which is also its key on the app. */
  readonly name: N;
  /** The normalised, frozen spec. */
  readonly spec: { readonly [field: string]: unknown };
  /** The plugin's own events. */
  readonly catalog: readonly CatalogEntry[];
  /** Type-only carrier. Empty at runtime. */
  readonly _phantom: T;
}

/**
 * Any plugin definition.
 *
 * @example
 * ```ts
 * const plugins: AnyPlugin[] = [routerPlugin, seoPlugin];
 * ```
 */
export type AnyPlugin = PluginDefinition;

/**
 * Any plugin definition created by the framework with id `F`.
 *
 * @example
 * ```ts
 * const plugins: AnyPluginOf<"site">[] = [routerPlugin];
 * ```
 */
export type AnyPluginOf<F extends string> = PluginDefinition<
  string,
  Omit<PluginTypes, "framework"> & { readonly framework: F }
>;

/**
 * A named, ordered group of plugins for one framework, created with `framework.pack()`.
 *
 * @example
 * ```ts
 * const stagePack: Pack<"roomStage"> = web.pack("roomStage", [peerPlugin, stagePlugin]);
 * ```
 */
export interface Pack<
  N extends string = string,
  P extends readonly AnyPlugin[] = readonly AnyPlugin[],
  F extends string = string
> {
  /** Always `"pack"`. */
  readonly kind: "pack";
  /** Id of the framework the pack was made for. */
  readonly framework: F;
  /** The pack name. */
  readonly name: N;
  /** The plugins, in order. */
  readonly plugins: P;
}

/**
 * A plugin or a pack of the framework with id `F`.
 *
 * @example
 * ```ts
 * const plugins: PluginOrPack<"site">[] = [stagePack, gamePlugin];
 * ```
 */
export type PluginOrPack<F extends string> = AnyPluginOf<F> | Pack<string, readonly AnyPlugin[], F>;

/**
 * Flattens a list of plugins and packs into a union of plugin definitions.
 *
 * @example
 * ```ts
 * type P = Flatten<readonly [typeof stagePack, typeof gamePlugin]>; // peer | stage | game
 * ```
 */
export type Flatten<L extends readonly unknown[]> = FlattenItem<L[number]>;

/**
 * Flattens one list item: a pack becomes its plugins, a plugin stays itself.
 *
 * @example
 * ```ts
 * type P = FlattenItem<typeof stagePack>; // peer | stage
 * ```
 */
export type FlattenItem<X> = X extends Pack<string, infer P> ? P[number] : X;

/**
 * The types a service definition carries in its phantom field.
 *
 * @example
 * ```ts
 * type LogTypes = (typeof logService)["_phantom"];
 * ```
 */
export interface ServiceTypes {
  /** Resolved config. */
  readonly config: unknown;
  /** Override input type; `never` when the service has no config. */
  readonly input: unknown;
  /** Private state. */
  readonly state: unknown;
  /** Public API, injected flat on every plugin context and mounted on the app. */
  readonly api: unknown;
}

/**
 * A frozen service definition, as returned by `defineService`.
 *
 * @example
 * ```ts
 * const logService: ServiceDefinition<"log"> = defineService("log", { … });
 * ```
 */
export interface ServiceDefinition<
  N extends string = string,
  T extends ServiceTypes = ServiceTypes
> {
  /** Always `"service"`. */
  readonly kind: "service";
  /** The service name, which is also its key on plugin contexts and the app. */
  readonly name: N;
  /** The normalised, frozen spec. */
  readonly spec: { readonly [field: string]: unknown };
  /** Type-only carrier. Empty at runtime. */
  readonly _phantom: T;
}

/**
 * Any service definition.
 *
 * @example
 * ```ts
 * const services: AnyService[] = [envService, logService];
 * ```
 */
export type AnyService = ServiceDefinition;

/**
 * The name of a plugin or service definition.
 *
 * @example
 * ```ts
 * type N = NameOf<typeof routerPlugin>; // "router"
 * ```
 */
export type NameOf<X> = X extends { readonly name: infer N extends string } ? N : never;

/**
 * The API of a plugin or service definition.
 *
 * @example
 * ```ts
 * type RouterApi = ApiOf<typeof routerPlugin>;
 * ```
 */
export type ApiOf<X> = X extends { readonly _phantom: { readonly api: infer A } } ? A : never;

/**
 * The override input type of a plugin or service definition (`never` without config).
 *
 * @example
 * ```ts
 * type In = InputOf<typeof routerPlugin>; // { basePath?: string }
 * ```
 */
export type InputOf<X> = X extends { readonly _phantom: { readonly input: infer I } } ? I : never;

/**
 * The own event catalog of a plugin definition.
 *
 * @example
 * ```ts
 * type E = EventsOf<typeof routerPlugin>; // { "router:navigate": EventDescriptor<…> }
 * ```
 */
export type EventsOf<X> = X extends { readonly _phantom: { readonly events: infer E } } ? E : never;

/**
 * Plugin APIs keyed by plugin name. Plugins with an empty API or a non-literal
 * name are left out.
 *
 * @example
 * ```ts
 * type Apis = PluginApis<typeof routerPlugin | typeof seoPlugin>; // { router: …; seo: … }
 * ```
 */
export type PluginApis<P> = {
  readonly [X in P as HasPublicApi<X> extends true ? NameOf<X> : never]: ApiOf<X>;
};

/**
 * Service APIs keyed by service name. Same filtering as {@link PluginApis}.
 *
 * @example
 * ```ts
 * type Apis = ServiceApis<typeof logService>; // { log: LogApi }
 * ```
 */
export type ServiceApis<S> = {
  readonly [X in S as HasPublicApi<X> extends true ? NameOf<X> : never]: ApiOf<X>;
};

/**
 * `true` when a definition has a literal name and a non-empty API.
 *
 * @example
 * ```ts
 * type A = HasPublicApi<typeof routerPlugin>; // true
 * ```
 */
export type HasPublicApi<X> =
  IsLiteralString<NameOf<X>> extends true
    ? [keyof ApiOf<X>] extends [never]
      ? false
      : true
    : false;

/**
 * Pure static functions merged onto a definition.
 *
 * @example
 * ```ts
 * const helpers: Helpers = { route: (path: string) => ({ path }) };
 * ```
 */
export type Helpers = { readonly [name: string]: (...rest: never[]) => unknown };

// ─── Framework ───────────────────────────────────────────────────────────────

/**
 * The types a framework carries through `definePlugin`, `pack` and `compose`.
 *
 * @example
 * ```ts
 * type SiteTypes = (typeof site)["_phantom"];
 * ```
 */
export interface FrameworkTypes {
  /** The framework id. */
  readonly id: string;
  /** Resolved global config (`ctx.global`). */
  readonly config: unknown;
  /** Global config override input. */
  readonly input: unknown;
  /** Global event catalog. */
  readonly events: EventMap;
  /** Union of the framework's service definitions. */
  readonly services: AnyService;
  /** Service config overrides set in `defineFramework`, used to work out required keys. */
  readonly serviceConfigs: object;
}

// ─── Contexts (§24) ──────────────────────────────────────────────────────────

/**
 * Context for a plugin's `state` factory: global config, own config, services.
 *
 * @example
 * ```ts
 * state: ({ config }) => ({ current: config.basePath })
 * ```
 */
export type StateContext<FT extends FrameworkTypes, C> = {
  /** The frozen global config. */
  readonly global: Readonly<FT["config"]>;
  /** The plugin's frozen config. */
  readonly config: Readonly<C>;
} & ServiceApis<FT["services"]>;

/**
 * Context for `api`, `hooks`, `onInit`, `onStart`, handlers and API method bodies.
 * Inside the `api` factory itself `emit` throws `E_EMIT_DURING_WIRING`.
 *
 * @example
 * ```ts
 * api: ctx => ({ navigate: (to: string) => ctx.emit("router:navigate", { to }) })
 * ```
 */
export type PluginContext<FT extends FrameworkTypes, C, S, V, D, OD> = StateContext<FT, C> & {
  /** The plugin's private mutable state. */
  readonly state: S;
  /** Fire-and-forget emit. Handlers run on a later microtask. */
  readonly emit: EmitFunction<V>;
  /**
   * The API of a plugin listed in `depends`.
   *
   * @param plugin - A plugin definition from `depends`.
   * @returns Its API.
   */
  get<P extends D>(plugin: P): ApiOf<P>;
  /**
   * The API of a plugin listed in `optionalDepends`, or `undefined` if it isn't in the app.
   *
   * @param plugin - A plugin definition from `optionalDepends`.
   * @returns Its API, or `undefined`.
   */
  find<P extends OD>(plugin: P): ApiOf<P> | undefined;
  /**
   * Whether a plugin or service is part of the app.
   *
   * @param plugin - A definition, or a name.
   * @returns `true` if present.
   */
  has(plugin: AnyPlugin | AnyService | string): boolean;
};

/**
 * Context for a plugin's `onStop`: no communication, but services are still alive.
 *
 * @example
 * ```ts
 * onStop: async ({ state }) => { await state.connection.close(); }
 * ```
 */
export type TeardownContext<FT extends FrameworkTypes, C, S> = StateContext<FT, C> & {
  /** The plugin's private mutable state. */
  readonly state: S;
};

/**
 * Context for a service's `state` factory.
 *
 * @example
 * ```ts
 * state: ({ config }) => ({ level: config.level })
 * ```
 */
export type ServiceStateContext<C, D> = {
  /** The frozen global config. Services are framework-agnostic, so it is untyped. */
  readonly global: Readonly<Record<string, unknown>>;
  /** The service's frozen config. */
  readonly config: Readonly<C>;
} & ServiceApis<D>;

/**
 * Context for a service's `api`, `onInit`, `onStart` and `onStop`.
 *
 * @example
 * ```ts
 * api: ({ config, state }) => ({ info: (message: string) => state.write(config.level, message) })
 * ```
 */
export type ServiceContext<C, S, D> = ServiceStateContext<C, D> & {
  /** The service's private mutable state. */
  readonly state: S;
};

/**
 * Field bag for {@link PluginCtx}. Every field is optional.
 *
 * @example
 * ```ts
 * type Fields = { config: RouterConfig; state: RouterState; events: RouterEvents };
 * ```
 */
// eslint-disable-next-line unicorn/prevent-abbreviations -- pairs with PluginCtx
export interface PluginCtxTypes {
  /** Resolved config. */
  readonly config?: object;
  /** Private state. */
  readonly state?: unknown;
  /** Events this code emits, as a name → payload map. */
  readonly events?: object;
  /** Plugins reachable through `get`. */
  readonly depends?: readonly AnyPlugin[];
  /** Plugins reachable through `find`. */
  readonly optionalDepends?: readonly AnyPlugin[];
  /** Global config. */
  readonly global?: object;
  /** Service APIs, keyed by service name. */
  readonly services?: object;
}

/**
 * Reads a field from a {@link PluginCtxTypes} bag, with a fallback.
 *
 * @example
 * ```ts
 * type C = ContextField<{ config: { a: 1 } }, "config", EmptyObject>; // { a: 1 }
 * ```
 */
export type ContextField<T, K extends keyof PluginCtxTypes, Fallback> = T extends {
  readonly [P in K]: infer V;
}
  ? V
  : Fallback;

/**
 * A plugin context type for extracted domain files (`api.ts`, `handlers.ts`), built
 * from named fields so nothing is positional.
 *
 * @example
 * ```ts
 * type RouterCtx = PluginCtx<{ config: RouterConfig; state: RouterState; events: RouterEvents }>;
 * export const createRouterApi = (ctx: RouterCtx) => ({ current: () => ctx.state.current });
 * ```
 */
// eslint-disable-next-line unicorn/prevent-abbreviations -- name fixed by the design (§19, §31)
export type PluginCtx<T extends PluginCtxTypes = EmptyObject> = {
  /** The frozen global config. */
  readonly global: Readonly<ContextField<T, "global", EmptyObject>>;
  /** The plugin's frozen config. */
  readonly config: Readonly<ContextField<T, "config", EmptyObject>>;
  /** The plugin's private mutable state. */
  readonly state: ContextField<T, "state", EmptyObject>;
  /** Fire-and-forget emit. */
  readonly emit: EmitFunction<ContextField<T, "events", EmptyObject>>;
  /**
   * The API of a declared dependency.
   *
   * @param plugin - A plugin definition from `depends`.
   * @returns Its API.
   */
  get<P extends ContextField<T, "depends", readonly []>[number]>(plugin: P): ApiOf<P>;
  /**
   * The API of an optional dependency, or `undefined`.
   *
   * @param plugin - A plugin definition from `optionalDepends`.
   * @returns Its API, or `undefined`.
   */
  find<P extends ContextField<T, "optionalDepends", readonly []>[number]>(
    plugin: P
  ): ApiOf<P> | undefined;
  /**
   * Whether a plugin or service is part of the app.
   *
   * @param plugin - A definition, or a name.
   * @returns `true` if present.
   */
  has(plugin: AnyPlugin | AnyService | string): boolean;
} & ContextField<T, "services", EmptyObject>;

// ─── Plugin and service specs ────────────────────────────────────────────────

/**
 * The events a plugin can emit and hook: global + own + direct dependencies.
 *
 * @example
 * ```ts
 * type V = VisibleEvents<SiteTypes, OwnEvents, typeof rendererPlugin, never>;
 * ```
 */
export type VisibleEvents<FT extends FrameworkTypes, E, D, OD> = PayloadMap<
  FT["events"] & E & UnionToIntersection<EventsOf<D | OD>>
>;

/**
 * The spec object `definePlugin` accepts. Every field is optional and every type is
 * inferred; write fields in this order so later ones can see earlier ones.
 *
 * @example
 * ```ts
 * definePlugin("counter", {
 *   config: { step: 1 },
 *   state: () => ({ count: 0 }),
 *   api: ctx => ({ increment: () => { ctx.state.count += ctx.config.step; } })
 * });
 * ```
 */
export interface PluginSpec<
  FT extends FrameworkTypes,
  N extends string,
  CS,
  S,
  A,
  E,
  D extends readonly AnyPlugin[],
  OD extends readonly AnyPlugin[],
  HK,
  H
> {
  /** Complete defaults, or a Standard Schema. */
  readonly config?: CS;
  /** Own events: `{ "<name>:<action>": event<Payload>("description") }`. */
  readonly events?: E & EventNamespaceCheck<N, E>;
  /** Required dependencies. They must come earlier in the plugin list. */
  readonly depends?: D;
  /** Optional dependencies, reached with `ctx.find`. If present they must come earlier. */
  readonly optionalDepends?: OD;
  /** Creates the private state. Called once per app. */
  readonly state?: (context: StateContext<FT, ConfigOutput<CS>>) => S;
  /** Builds the public API. Must be synchronous and must not emit. */
  readonly api?: (
    context: PluginContext<
      FT,
      ConfigOutput<CS>,
      S,
      VisibleEvents<FT, E, D[number], OD[number]>,
      D[number],
      OD[number]
    >
  ) => A;
  /** Subscribes to visible events. Runs after every API exists. */
  readonly hooks?: (
    context: PluginContext<
      FT,
      ConfigOutput<CS>,
      S,
      VisibleEvents<FT, E, D[number], OD[number]>,
      D[number],
      OD[number]
    >
  ) => HookHandlers<VisibleEvents<FT, E, D[number], OD[number]>, HK>;
  /** Loads and validates. May be async; awaited in order inside `createApp`. */
  readonly onInit?: (
    context: PluginContext<
      FT,
      ConfigOutput<CS>,
      S,
      VisibleEvents<FT, E, D[number], OD[number]>,
      D[number],
      OD[number]
    >
  ) => void | Promise<void>;
  /** Acquires resources. Awaited in order inside `app.start()`. */
  readonly onStart?: (
    context: PluginContext<
      FT,
      ConfigOutput<CS>,
      S,
      VisibleEvents<FT, E, D[number], OD[number]>,
      D[number],
      OD[number]
    >
  ) => void | Promise<void>;
  /** Releases resources. Awaited in reverse order inside `app.stop()`. */
  readonly onStop?: (context: TeardownContext<FT, ConfigOutput<CS>, S>) => void | Promise<void>;
  /** Pure static functions merged onto the definition. */
  readonly helpers?: H;
}

/**
 * The definition type `definePlugin` returns.
 *
 * @example
 * ```ts
 * type Router = DefinedPlugin<SiteTypes, "router", { basePath: string }, RouterState, RouterApi, RouterCatalog>;
 * ```
 */
export type DefinedPlugin<
  FT extends FrameworkTypes,
  N extends string,
  CS,
  S,
  A,
  E extends EventMap
> = PluginDefinition<
  N,
  {
    readonly framework: FT["id"];
    readonly config: ConfigOutput<CS>;
    readonly input: ConfigInput<CS>;
    readonly state: S;
    readonly api: A;
    readonly events: E;
  }
>;

/**
 * The `definePlugin` function a framework hands out.
 *
 * @example
 * ```ts
 * export const definePlugin: DefinePlugin<SiteTypes> = site.definePlugin;
 * ```
 */
export type DefinePlugin<FT extends FrameworkTypes> = <
  const N extends string,
  CS extends ConfigSpec | undefined = undefined,
  S = EmptyObject,
  A = EmptyObject,
  E extends EventMap = EmptyObject,
  const D extends readonly AnyPluginOf<FT["id"]>[] = readonly [],
  const OD extends readonly AnyPluginOf<FT["id"]>[] = readonly [],
  HK = EmptyObject,
  H extends Helpers = EmptyObject
>(
  name: N,
  spec: PluginSpec<FT, N, CS, S, A, E, D, OD, HK, H>
) => DefinedPlugin<FT, N, CS, S, A, E> & H;

/**
 * The spec object `defineService` accepts.
 *
 * @example
 * ```ts
 * defineService("log", {
 *   config: { level: "info" as Level },
 *   api: ({ config }) => ({ info: (message: string) => write(config.level, message) })
 * });
 * ```
 */
export interface ServiceSpec<CS, S, A, D extends readonly AnyService[]> {
  /** Complete defaults, or a Standard Schema. */
  readonly config?: CS;
  /** Services this one uses. They must come earlier in the framework's list. */
  readonly depends?: D;
  /** Creates the private state. */
  readonly state?: (context: ServiceStateContext<ConfigOutput<CS>, D[number]>) => S;
  /** Builds the public API. Must be synchronous. */
  readonly api?: (context: ServiceContext<ConfigOutput<CS>, S, D[number]>) => A;
  /** Loads and validates. Runs before every plugin's `onInit`. */
  readonly onInit?: (
    context: ServiceContext<ConfigOutput<CS>, S, D[number]>
  ) => void | Promise<void>;
  /** Acquires resources. Runs before every plugin's `onStart`. */
  readonly onStart?: (
    context: ServiceContext<ConfigOutput<CS>, S, D[number]>
  ) => void | Promise<void>;
  /** Releases resources. Runs after every plugin's `onStop`. */
  readonly onStop?: (
    context: ServiceContext<ConfigOutput<CS>, S, D[number]>
  ) => void | Promise<void>;
}

/**
 * The definition type `defineService` returns.
 *
 * @example
 * ```ts
 * type Log = DefinedService<"log", { level: Level }, EmptyObject, LogApi>;
 * ```
 */
export type DefinedService<N extends string, CS, S, A> = ServiceDefinition<
  N,
  {
    readonly config: ConfigOutput<CS>;
    readonly input: ConfigInput<CS>;
    readonly state: S;
    readonly api: A;
  }
>;

// ─── Config overrides ────────────────────────────────────────────────────────

/**
 * Names of definitions in `X` that take config overrides.
 *
 * @example
 * ```ts
 * type N = ConfigurableName<typeof routerPlugin | typeof seoPlugin>; // "router" | "seo"
 * ```
 */
export type ConfigurableName<X> = X extends unknown
  ? [InputOf<X>] extends [never]
    ? never
    : IsLiteralString<NameOf<X>> extends true
      ? NameOf<X>
      : never
  : never;

/**
 * Every override map is optional per key: what `defineFramework.serviceConfigs` and
 * `compose.pluginConfigs` accept.
 *
 * @example
 * ```ts
 * const overrides: PartialOverrides<typeof routerPlugin> = { router: { basePath: "/blog" } };
 * ```
 */
export type PartialOverrides<X> = {
  readonly [Y in X as ConfigurableName<Y>]?: Partial<InputOf<Y>>;
};

/**
 * Rejects keys of `O` (and of its values) that `T` doesn't have. Used where an
 * override object is captured as a generic and so escapes excess-property checks.
 *
 * @example
 * ```ts
 * type Bad = StrictOverrides<{ rooter: {} }, { router?: {} }>; // { rooter: never }
 * ```
 */
export type StrictOverrides<O, T> = {
  [K in keyof O]: K extends keyof T
    ? { [J in keyof O[K]]: J extends keyof NonNullable<T[K]> ? unknown : never }
    : never;
};

/**
 * Required config keys of a definition that no earlier layer supplied.
 *
 * @example
 * ```ts
 * type K = RemainingKeys<typeof analyticsPlugin, EmptyObject>; // "trackingId"
 * ```
 */
export type RemainingKeys<X, Supplied> = Exclude<
  RequiredKeysOf<InputOf<X>>,
  NameOf<X> extends keyof Supplied ? keyof Supplied[NameOf<X>] : never
>;

/**
 * Union of every remaining required key across `X`; `never` when nothing is required.
 *
 * @example
 * ```ts
 * type K = AnyRemainingKeys<typeof analyticsPlugin | typeof routerPlugin, EmptyObject>; // "trackingId"
 * ```
 */
export type AnyRemainingKeys<X, Supplied> = X extends unknown ? RemainingKeys<X, Supplied> : never;

/**
 * The `pluginConfigs` map `createApp` accepts. An entry is required when its schema
 * has a field without a default that the framework didn't already supply (O15).
 *
 * @example
 * ```ts
 * const overrides: AppOverrides<typeof analyticsPlugin, EmptyObject> = {
 *   analytics: { trackingId: "G-123" }
 * };
 * ```
 */
export type AppOverrides<X, Supplied> = Prettify<
  {
    readonly [Y in X as [RemainingKeys<Y, Supplied>] extends [never]
      ? ConfigurableName<Y>
      : never]?: Partial<InputOf<Y>>;
  } & {
    readonly [Y in X as [RemainingKeys<Y, Supplied>] extends [never]
      ? never
      : ConfigurableName<Y>]: Prettify<
      Partial<InputOf<Y>> & {
        [K in Extract<keyof InputOf<Y>, RemainingKeys<Y, Supplied>>]: InputOf<Y>[K];
      }
    >;
  }
>;

// ─── App ─────────────────────────────────────────────────────────────────────

/**
 * Lifecycle state of an app (§27.1).
 *
 * @example
 * ```ts
 * if (app.status === "running") await app.stop();
 * ```
 */
export type AppStatus =
  | "ready"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "rollingBack"
  | "failed";

/**
 * Every event in an app (global + every plugin's), as a name → payload map.
 *
 * @example
 * ```ts
 * type E = AppEvents<SiteTypes, typeof routerPlugin>; // { "page:render": …; "router:navigate": … }
 * ```
 */
export type AppEvents<FT extends FrameworkTypes, P> = PayloadMap<
  FT["events"] & UnionToIntersection<EventsOf<P>>
>;

/**
 * Context for framework and consumer callbacks (`onReady`, `onStart`, `onStop`, `onError`).
 *
 * @example
 * ```ts
 * createApp({ onReady: ctx => ctx.router.navigate("/") });
 * ```
 */
export type AppContext<FT extends FrameworkTypes, P> = {
  /** The frozen global config. */
  readonly global: Readonly<FT["config"]>;
  /** Fire-and-forget emit, typed with every event in the app. */
  readonly emit: EmitFunction<AppEvents<FT, P>>;
  /**
   * The API of any plugin in the app. Throws if it isn't registered.
   *
   * @param plugin - A plugin definition.
   * @returns Its API.
   */
  get<X extends P>(plugin: X): ApiOf<X>;
  /**
   * The API of a plugin, or `undefined` if it isn't in the app.
   *
   * @param plugin - A plugin definition.
   * @returns Its API, or `undefined`.
   */
  find<X extends AnyPlugin>(plugin: X): ApiOf<X> | undefined;
  /**
   * Whether a plugin or service is part of the app.
   *
   * @param plugin - A definition, or a name.
   * @returns `true` if present.
   */
  has(plugin: AnyPlugin | AnyService | string): boolean;
} & PluginApis<P> &
  ServiceApis<FT["services"]>;

/**
 * A running Basalt app: lifecycle, events, and every plugin and service API. Frozen.
 *
 * @example
 * ```ts
 * const app = await createApp();
 * await app.start();
 * app.router.navigate("/about");
 * await app.settled();
 * await app.stop();
 * ```
 */
export type App<FT extends FrameworkTypes, P> = AppContext<FT, P> & {
  /** The current lifecycle state. */
  readonly status: AppStatus;
  /**
   * Runs every `onStart` in order: services, plugins, framework, consumer.
   *
   * @returns Resolves when the app is running.
   */
  start(): Promise<void>;
  /**
   * Waits for in-flight events, then runs every `onStop` in reverse. Idempotent.
   *
   * @returns Resolves when the app is stopped.
   */
  stop(): Promise<void>;
  /**
   * Resolves once no event delivery is in flight.
   *
   * @returns Resolves when every queued handler has finished.
   */
  settled(): Promise<void>;
};

/**
 * Lifecycle callback taking an app context.
 *
 * @example
 * ```ts
 * const onReady: AppCallback<SiteTypes, typeof routerPlugin> = ctx => ctx.router.current();
 * ```
 */
export type AppCallback<FT extends FrameworkTypes, P> = (
  context: AppContext<FT, P>
) => void | Promise<void>;

/**
 * Error callback. Receives handler failures and other reported errors.
 *
 * @example
 * ```ts
 * const onError: ErrorCallback<SiteTypes, never> = (error, ctx) => report(error.code);
 * ```
 */
export type ErrorCallback<FT extends FrameworkTypes, P> = (
  error: BasaltError,
  context: AppContext<FT, P>
) => void;

/**
 * Options for `framework.compose`.
 *
 * @example
 * ```ts
 * site.compose({ plugins: [rendererPlugin, routerPlugin], pluginConfigs: { router: { basePath: "/" } } });
 * ```
 */
export interface ComposeOptions<FT extends FrameworkTypes, P extends readonly unknown[], O> {
  /** Default plugins and packs, in order. Validated immediately. */
  readonly plugins: P;
  /** Framework-level overrides for plugins and services. */
  readonly pluginConfigs?: O & StrictOverrides<O, PartialOverrides<FT["services"] | Flatten<P>>>;
  /** Runs after every `onInit`, before the consumer's `onReady`. */
  readonly onReady?: AppCallback<FT, Flatten<P>>;
  /** Runs after every plugin's `onStart`, before the consumer's. */
  readonly onStart?: AppCallback<FT, Flatten<P>>;
  /** Runs before every plugin's `onStop`, after the consumer's. */
  readonly onStop?: AppCallback<FT, Flatten<P>>;
  /** Receives reported errors before the consumer's `onError`. */
  readonly onError?: ErrorCallback<FT, Flatten<P>>;
}

/**
 * Every config key still required for `createApp`: global config, plugins and services.
 *
 * @example
 * ```ts
 * type K = MissingConfig<SiteTypes, typeof analyticsPlugin, EmptyObject>; // "trackingId"
 * ```
 */
export type MissingConfig<FT extends FrameworkTypes, P, Supplied> =
  | RequiredKeysOf<FT["input"]>
  | AnyRemainingKeys<FT["services"] | P, Supplied>;

/**
 * Options for `createApp`. `config` and `pluginConfigs` become required when a schema
 * field without a default is still unset.
 *
 * @example
 * ```ts
 * await createApp({ plugins: [blogPlugin], config: { siteName: "Blog" } });
 * ```
 */
export type CreateAppOptions<FT extends FrameworkTypes, P, Supplied, EP> = {
  /** Extra plugins and packs, appended after the framework defaults. */
  readonly plugins?: EP;
  /** Runs after every `onInit` and the framework's `onReady`. */
  readonly onReady?: AppCallback<FT, P>;
  /** Runs last in `app.start()`. */
  readonly onStart?: AppCallback<FT, P>;
  /** Runs first in `app.stop()`, while everything is still alive. */
  readonly onStop?: AppCallback<FT, P>;
  /** Receives reported errors after the framework's `onError`. */
  readonly onError?: ErrorCallback<FT, P>;
} & ([RequiredKeysOf<FT["input"]>] extends [never]
  ? {
      /** Global config overrides. */
      readonly config?: Partial<FT["input"]>;
    }
  : {
      /** Global config overrides. Required: some fields have no default. */
      readonly config: Prettify<
        Partial<FT["input"]> & {
          [K in Extract<keyof FT["input"], RequiredKeysOf<FT["input"]>>]: FT["input"][K];
        }
      >;
    }) &
  ([AnyRemainingKeys<FT["services"] | P, Supplied>] extends [never]
    ? {
        /** Plugin and service config overrides, keyed by name. */
        readonly pluginConfigs?: AppOverrides<FT["services"] | P, Supplied>;
      }
    : {
        /** Plugin and service config overrides. Required: some fields have no default. */
        readonly pluginConfigs: AppOverrides<FT["services"] | P, Supplied>;
      });

/**
 * The `createApp` function `compose` returns. Async: it resolves once every config is
 * validated and every `onInit` has finished. Callable without options only when no
 * config is required.
 *
 * @example
 * ```ts
 * const app = await createApp({ plugins: [blogPlugin] });
 * ```
 */
export type CreateApp<FT extends FrameworkTypes, DP, Supplied> = (<
  const EP extends readonly PluginOrPack<FT["id"]>[] = readonly []
>(
  options: CreateAppOptions<FT, DP | Flatten<EP>, Supplied, EP>
) => Promise<App<FT, DP | Flatten<EP>>>) &
  ([MissingConfig<FT, DP, Supplied>] extends [never] ? () => Promise<App<FT, DP>> : unknown);

/**
 * What `compose` returns.
 *
 * @example
 * ```ts
 * const composed = site.compose({ plugins: [routerPlugin] });
 * export const createApp = composed.createApp;
 * ```
 */
export interface Composed<FT extends FrameworkTypes, DP, Supplied> {
  /** Creates an app with the framework defaults plus the consumer's plugins. */
  readonly createApp: CreateApp<FT, DP, Supplied>;
}

/**
 * A framework, as returned by `defineFramework`. Frozen.
 *
 * @example
 * ```ts
 * const site = defineFramework("site", { config: { siteName: "Untitled" } });
 * export const definePlugin = site.definePlugin;
 * ```
 */
export interface Framework<FT extends FrameworkTypes> {
  /** The framework id, used in every error message. */
  readonly id: FT["id"];
  /** Type-only carrier. Empty at runtime. */
  readonly _phantom: FT;
  /** Defines a plugin bound to this framework's config, events and services. */
  readonly definePlugin: DefinePlugin<FT>;
  /**
   * Groups plugins into a named pack, flattened in place wherever it is used.
   *
   * @param name - The pack name.
   * @param plugins - The plugins, in order.
   * @returns A frozen pack.
   */
  pack<const N extends string, const P extends readonly AnyPluginOf<FT["id"]>[]>(
    name: N,
    plugins: P
  ): Pack<N, P, FT["id"]>;
  /**
   * Sets the default plugins and framework callbacks, validating them immediately.
   *
   * @param options - Default plugins, overrides and callbacks.
   * @returns `{ createApp }`.
   */
  compose<
    const P extends readonly PluginOrPack<FT["id"]>[],
    const O extends PartialOverrides<FT["services"] | Flatten<P>> = EmptyObject
  >(options: ComposeOptions<FT, P, O>): Composed<FT, Flatten<P>, O & FT["serviceConfigs"]>;
}

/**
 * Options for `defineFramework`.
 *
 * @example
 * ```ts
 * defineFramework("site", {
 *   config: { siteName: "Untitled" },
 *   events: { "page:render": event<{ path: string }>("A page finished rendering") },
 *   services: [envService, logService]
 * });
 * ```
 */
export interface FrameworkOptions<CS, E, SV extends readonly AnyService[], SC extends object> {
  /** Global config: complete defaults, or a Standard Schema. */
  readonly config?: CS;
  /** Global events: `{ "<domain>:<action>": event<Payload>("description") }`. */
  readonly events?: E & GlobalEventCheck<E>;
  /** Services, in order. A service may depend on earlier ones. */
  readonly services?: SV;
  /** Framework-level service config overrides. */
  readonly serviceConfigs?: SC & StrictOverrides<SC, PartialOverrides<SV[number]>>;
}

/**
 * The framework type `defineFramework` returns, given resolved config output and input types.
 *
 * @example
 * ```ts
 * type Site = DefinedFramework<"site", SiteConfig, Partial<SiteConfig>, EmptyObject, readonly [], EmptyObject>;
 * ```
 */
export type DefinedFramework<
  Id extends string,
  Output,
  Input,
  E extends EventMap,
  SV extends readonly AnyService[],
  SC extends object
> = Framework<{
  readonly id: Id;
  readonly config: Output;
  readonly input: [Input] extends [never] ? EmptyObject : Input;
  readonly events: E;
  readonly services: SV[number];
  readonly serviceConfigs: SC;
}>;

/**
 * The curried `defineFramework<Config>()` form: the config type is written out, the
 * rest is inferred.
 *
 * @example
 * ```ts
 * const site = defineFramework<SiteConfig>()("site", { config: { mode: "development" } });
 * ```
 */
export type DefineFrameworkWithConfig<C> = <
  const Id extends string,
  CS extends C | StandardSchemaV1<unknown, C>,
  E extends EventMap = EmptyObject,
  const SV extends readonly AnyService[] = readonly [],
  const SC extends PartialOverrides<SV[number]> = EmptyObject
>(
  id: Id,
  options: FrameworkOptions<CS, E, SV, SC> & { readonly config: CS }
) => DefinedFramework<Id, C, CS extends StandardSchemaV1 ? ConfigInput<CS> : Partial<C>, E, SV, SC>;
